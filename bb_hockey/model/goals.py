"""NHL goals model: the two scoring rates behind a devigged ML + total.

The market gives us two numbers per game — the fair home win probability
(full game, OT/SO included) and the fair over probability at the quoted
total — and we need a whole distribution of final scores, regulation
scores and period scores to price derivatives from. The model:

* Regulation goals are independent Poisson(λ_h), Poisson(λ_a), with the
  diagonal (tied regulation scores) inflated by ``draw_inflation`` and the
  matrix renormalised — the diagonal-inflated bivariate Poisson of Karlis &
  Ntzoufras (2003). Plain independence gives ~17% regulation ties at NHL
  rates against ~23% observed; score effects (trailing team pressing,
  leading team sitting back) are the gap.
* Empty-net goals: a share ``eng_rate`` of one-goal regulation wins become
  two-goal wins (the goal counts toward the total too). This is what makes
  −1.5 cover more often than a bare Poisson says and is the single most
  important correction for puck lines.
* Tied after 60: decided in OT with probability ``ot_decided_share``,
  otherwise a shootout. Home wins OT with ``0.5 + ot_skill_k·(p_reg_home −
  p_reg_away)``, the shootout with ``so_skill_k`` likewise (small: 3v3 and
  shootouts are close to coin flips). The winner's goal counts for one on
  the total and gives a one-goal margin.
* Periods: period k scores at ``period_shares[k]`` of the regulation rate
  (third periods carry the empty-net goals, so the shares rise through the
  game), with their own smaller diagonal inflation.

Everything downstream reads probabilities off ``GameModel`` through
``prob_for(market, side, point)`` so any book point can be priced, not just
the standard menu. Parameters are priors to be checked against the
calibration page, not fitted truths — the calibration page is the point of
the project.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, Optional, Tuple

import numpy as np
from scipy.optimize import least_squares
from scipy.stats import poisson

from .odds_math import fair_price_no_push, prob_to_american

MARKETS = (
    "ml", "3way", "puck", "total", "reg_total", "team_total_home", "team_total_away",
    "p1_ml", "p1_3way", "p1_spread", "p1_total",
    "p2_ml", "p2_3way", "p2_spread", "p2_total",
    "p3_ml", "p3_3way", "p3_spread", "p3_total",
)


@dataclass
class ModelParams:
    max_goals: int = 12
    draw_inflation: float = 1.45
    eng_rate: float = 0.28
    ot_decided_share: float = 0.65
    ot_skill_k: float = 0.5
    so_skill_k: float = 0.2
    period_shares: Tuple[float, float, float] = (0.30, 0.335, 0.365)
    period_draw_inflation: float = 1.10
    default_total: float = 6.0  # used only when no total is quoted

    def to_dict(self) -> dict:
        d = asdict(self)
        d["period_shares"] = list(self.period_shares)
        return d

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "ModelParams":
        p = cls()
        for k, v in (d or {}).items():
            if hasattr(p, k) and v is not None:
                setattr(p, k, tuple(v) if k == "period_shares" else v)
        return p


def _inflated_matrix(lh: float, la: float, n: int, inflation: float) -> np.ndarray:
    ph = poisson.pmf(np.arange(n + 1), lh)
    pa = poisson.pmf(np.arange(n + 1), la)
    m = np.outer(ph, pa)
    m /= m.sum()  # truncate at n goals
    if inflation != 1.0:
        idx = np.arange(n + 1)
        m[idx, idx] *= inflation
        m /= m.sum()
    return m


def _apply_empty_net(m: np.ndarray, rate: float) -> np.ndarray:
    """Move ``rate`` of the mass on one-goal regulation wins to two-goal wins."""
    if rate <= 0:
        return m
    n = m.shape[0] - 1
    out = m.copy()
    for h in range(n + 1):
        for a in range(n + 1):
            if h - a == 1 and h + 1 <= n:
                mv = m[h, a] * rate
                out[h, a] -= mv
                out[h + 1, a] += mv
            elif a - h == 1 and a + 1 <= n:
                mv = m[h, a] * rate
                out[h, a] -= mv
                out[h, a + 1] += mv
    return out


class GameModel:
    """Score distributions for one game at rates (λ_h, λ_a)."""

    def __init__(self, lh: float, la: float, params: Optional[ModelParams] = None):
        self.params = params or ModelParams()
        self.lh, self.la = float(lh), float(la)
        p = self.params
        n = p.max_goals
        self.n = n
        self.reg = _apply_empty_net(_inflated_matrix(lh, la, n, p.draw_inflation), p.eng_rate)
        idx = np.arange(n + 1)
        H, A = np.meshgrid(idx, idx, indexing="ij")
        self.p_reg_home = float(self.reg[H > A].sum())
        self.p_reg_away = float(self.reg[H < A].sum())
        self.p_draw = float(self.reg[H == A].sum())
        skill = self.p_reg_home - self.p_reg_away
        self.p_ot_home = min(0.95, max(0.05, 0.5 + p.ot_skill_k * skill))
        self.p_so_home = min(0.95, max(0.05, 0.5 + p.so_skill_k * skill))
        self.p_tie_home = p.ot_decided_share * self.p_ot_home + (1 - p.ot_decided_share) * self.p_so_home
        # Final-score matrix: ties resolved by one extra goal to the winner.
        full = self.reg.copy()
        for k in range(n + 1):
            mass = full[k, k]
            full[k, k] = 0.0
            if k + 1 <= n:
                full[k + 1, k] += mass * self.p_tie_home
                full[k, k + 1] += mass * (1 - self.p_tie_home)
            else:  # truncated corner: keep the mass on the diagonal
                full[k, k] = mass
        self.full = full
        self.p_home = float(full[H > A].sum()) + float(full[H == A].sum()) * 0.5
        self.p_away = 1.0 - self.p_home
        self.margin_full = self._margin_dist(full)
        self.total_full = self._total_dist(full)
        self.total_reg = self._total_dist(self.reg)
        self.home_goals = full.sum(axis=1)
        self.away_goals = full.sum(axis=0)
        self.periods = []
        for share in p.period_shares:
            self.periods.append(_inflated_matrix(lh * share, la * share, n, p.period_draw_inflation))

    # -- distributions ----------------------------------------------------
    def _margin_dist(self, m: np.ndarray) -> Dict[int, float]:
        d: Dict[int, float] = {}
        for h in range(self.n + 1):
            for a in range(self.n + 1):
                d[h - a] = d.get(h - a, 0.0) + float(m[h, a])
        return d

    def _total_dist(self, m: np.ndarray) -> Dict[int, float]:
        d: Dict[int, float] = {}
        for h in range(self.n + 1):
            for a in range(self.n + 1):
                d[h + a] = d.get(h + a, 0.0) + float(m[h, a])
        return d

    @staticmethod
    def _over_under(dist: Dict[int, float], point: float) -> Tuple[float, float, float]:
        over = sum(v for k, v in dist.items() if k > point)
        push = sum(v for k, v in dist.items() if k == point)
        under = sum(v for k, v in dist.items() if k < point)
        return over, push, under

    @staticmethod
    def _spread(margin: Dict[int, float], point: float) -> Tuple[float, float]:
        """(win, push) for the side laid ``point`` (home −1.5 → point=-1.5)."""
        win = sum(v for k, v in margin.items() if k + point > 0)
        push = sum(v for k, v in margin.items() if k + point == 0)
        return win, push

    def _period_stats(self, k: int):
        m = self.periods[k]
        idx = np.arange(self.n + 1)
        H, A = np.meshgrid(idx, idx, indexing="ij")
        return (float(m[H > A].sum()), float(m[H == A].sum()), float(m[H < A].sum()),
                self._margin_dist(m), self._total_dist(m))

    # -- the one lookup everything uses -----------------------------------
    def prob_for(self, market: str, side: str, point: Optional[float] = None) -> Optional[Tuple[float, float]]:
        """(p_win, p_push) for a side of a market at a point, or None if unknown."""
        if market == "ml":
            return (self.p_home, 0.0) if side == "home" else (self.p_away, 0.0) if side == "away" else None
        if market == "3way":
            return {"home": (self.p_reg_home, 0.0), "draw": (self.p_draw, 0.0), "away": (self.p_reg_away, 0.0)}.get(side)
        if market == "puck":
            if point is None:
                return None
            if side == "home":
                return self._spread(self.margin_full, point)
            if side == "away":
                away_margin = {-k: v for k, v in self.margin_full.items()}
                return self._spread(away_margin, point)
            return None
        if market in ("total", "reg_total"):
            if point is None:
                return None
            o, p, u = self._over_under(self.total_full if market == "total" else self.total_reg, point)
            return (o, p) if side == "over" else (u, p) if side == "under" else None
        if market in ("team_total_home", "team_total_away"):
            if point is None:
                return None
            goals = self.home_goals if market.endswith("home") else self.away_goals
            dist = {i: float(goals[i]) for i in range(self.n + 1)}
            o, p, u = self._over_under(dist, point)
            return (o, p) if side == "over" else (u, p) if side == "under" else None
        if market[:1] == "p" and market[1:2].isdigit() and market[2:3] == "_":
            k = int(market[1]) - 1
            if not 0 <= k < 3:
                return None
            ph, pd, pa, margin, total = self._period_stats(k)
            kind = market[3:]
            if kind == "ml":  # two-way, tie pushes
                return (ph, pd) if side == "home" else (pa, pd) if side == "away" else None
            if kind == "3way":
                return {"home": (ph, 0.0), "draw": (pd, 0.0), "away": (pa, 0.0)}.get(side)
            if kind == "spread":
                if point is None:
                    return None
                if side == "home":
                    return self._spread(margin, point)
                if side == "away":
                    return self._spread({-m: v for m, v in margin.items()}, point)
                return None
            if kind == "total":
                if point is None:
                    return None
                o, p, u = self._over_under(total, point)
                return (o, p) if side == "over" else (u, p) if side == "under" else None
        return None

    # -- the standard menu -------------------------------------------------
    def board(self) -> list:
        rows = []

        def add(market, side, point=None, label=None):
            r = self.prob_for(market, side, point)
            if r is None:
                return
            p_win, p_push = r
            rows.append({
                "market": market, "side": side, "point": point,
                "prob": round(p_win, 5), "push": round(p_push, 5),
                "fair_price": fair_price_no_push(p_win, p_push),
                "label": label,
            })

        add("ml", "home"); add("ml", "away")
        for s in ("home", "draw", "away"):
            add("3way", s)
        for pt in (-3.5, -2.5, -1.5, 1.5, 2.5, 3.5):
            add("puck", "home", pt)
            add("puck", "away", pt)
        for pt in (4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.5):
            add("total", "over", pt); add("total", "under", pt)
        for pt in (4.5, 5.5, 6.5, 7.5):
            add("reg_total", "over", pt); add("reg_total", "under", pt)
        for mk in ("team_total_home", "team_total_away"):
            for pt in (1.5, 2.5, 3.0, 3.5, 4.5):
                add(mk, "over", pt); add(mk, "under", pt)
        for k in (1, 2, 3):
            add(f"p{k}_ml", "home"); add(f"p{k}_ml", "away")
            for s in ("home", "draw", "away"):
                add(f"p{k}_3way", s)
            for pt in (-1.5, -0.5, 0.5, 1.5):
                add(f"p{k}_spread", "home", pt); add(f"p{k}_spread", "away", pt)
            for pt in (0.5, 1.0, 1.5, 2.0, 2.5, 3.5):
                add(f"p{k}_total", "over", pt); add(f"p{k}_total", "under", pt)
        return rows

    def summary(self) -> dict:
        return {
            "lambda_home": round(self.lh, 4), "lambda_away": round(self.la, 4),
            "p_home": round(self.p_home, 5), "p_reg_home": round(self.p_reg_home, 5),
            "p_draw": round(self.p_draw, 5), "p_reg_away": round(self.p_reg_away, 5),
            "p_tie_home": round(self.p_tie_home, 5),
            "exp_total": round(sum(k * v for k, v in self.total_full.items()), 4),
            "exp_reg_total": round(sum(k * v for k, v in self.total_reg.items()), 4),
        }


def over_prob_conditional(model: GameModel, point: float) -> float:
    """P(over | no push) at ``point`` — the quantity a devigged over/under pair measures."""
    o, p, u = model._over_under(model.total_full, point)
    return o / (o + u) if (o + u) > 0 else 0.5


def fit_lambdas(p_home: float, total_point: float, p_over: float,
                params: Optional[ModelParams] = None) -> Tuple[float, float, dict]:
    """Solve (λ_h, λ_a) so the model reproduces the fair ML and the fair total.

    Returns (λ_h, λ_a, diagnostics). Two equations, two unknowns; solved in
    log-space with a bounded least-squares so a degenerate input (p_home
    0.99) cannot run the rates negative.
    """
    params = params or ModelParams()
    p_home = min(0.98, max(0.02, float(p_home)))
    p_over = min(0.98, max(0.02, float(p_over)))

    def resid(x):
        m = GameModel(np.exp(x[0]), np.exp(x[1]), params)
        return [m.p_home - p_home, over_prob_conditional(m, total_point) - p_over]

    # Start from the total split by a crude strength tilt.
    base = max(1.0, total_point) / 2.0
    tilt = (p_home - 0.5) * 1.6
    x0 = [np.log(max(0.3, base + tilt)), np.log(max(0.3, base - tilt))]
    sol = least_squares(resid, x0, bounds=([np.log(0.2)] * 2, [np.log(8.0)] * 2), xtol=1e-10, ftol=1e-10)
    lh, la = float(np.exp(sol.x[0])), float(np.exp(sol.x[1]))
    m = GameModel(lh, la, params)
    diag = {
        "resid_p_home": round(m.p_home - p_home, 6),
        "resid_p_over": round(over_prob_conditional(m, total_point) - p_over, 6),
        "converged": bool(sol.success and max(abs(r) for r in sol.fun) < 2e-4),
    }
    return lh, la, diag


def american(p: Optional[float]) -> Optional[float]:
    return prob_to_american(p)
