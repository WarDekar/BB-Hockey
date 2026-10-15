"""American-odds arithmetic and two-way de-vigging.

Mirrors the conventions BB-Odds uses (``bb_odds_client.betting_math`` and
``app/services/consensus.py``): implied probability from American odds,
Shin (1993) de-vig as the default for two-way prices (loads the hold onto
the longshot — proportional splitting under-prices favourites), power
(Vovk–Zhdanov) and proportional as alternatives.
"""
from __future__ import annotations

import math
from typing import Optional, Tuple


def american_to_prob(a: Optional[float]) -> Optional[float]:
    if a is None:
        return None
    a = float(a)
    if a == 0:
        return None
    return 100.0 / (a + 100.0) if a > 0 else (-a) / (-a + 100.0)


def american_to_decimal(a: Optional[float]) -> Optional[float]:
    if a is None:
        return None
    a = float(a)
    if a == 0:
        return None
    return 1.0 + a / 100.0 if a > 0 else 1.0 + 100.0 / (-a)


def prob_to_american(p: Optional[float]) -> Optional[float]:
    """Fair American price for a win probability (no hold)."""
    if p is None or p <= 0.0 or p >= 1.0:
        return None
    return -100.0 * p / (1.0 - p) if p >= 0.5 else 100.0 * (1.0 - p) / p


def fmt_american(a: Optional[float]) -> str:
    if a is None:
        return "—"
    r = int(round(a))
    return f"+{r}" if r > 0 else str(r)


def devig_two_way(price_a: float, price_b: float, method: str = "shin") -> Tuple[float, float]:
    """Fair (p_a, p_b) from a two-way American pair, summing to 1.

    ``shin``: Shin's insider-trading model, z solved by bisection so the
    fair probabilities sum to one. ``power``: exponent k with
    pa**k + pb**k == 1. ``proportional``: plain normalisation. Markets
    with no overround (sum <= 1) fall back to proportional.
    """
    ia, ib = american_to_prob(price_a), american_to_prob(price_b)
    if ia is None or ib is None:
        raise ValueError("both prices required")
    total = ia + ib
    if total <= 1.0 + 1e-9 or method == "proportional":
        return ia / total, ib / total
    if method == "power":
        lo, hi = 1.0, 10.0
        f = lambda k: ia ** k + ib ** k - 1.0  # noqa: E731
        for _ in range(100):
            mid = 0.5 * (lo + hi)
            if f(mid) > 0:
                lo = mid
            else:
                hi = mid
        k = 0.5 * (lo + hi)
        return ia ** k, ib ** k
    # shin: p_i = (sqrt(z^2 + 4(1-z) pi_i^2 / B) - z) / (2(1-z))
    B = total

    def shin_probs(z: float):
        d = 2.0 * (1.0 - z)
        return tuple((math.sqrt(z * z + 4.0 * (1.0 - z) * (pi * pi) / B) - z) / d for pi in (ia, ib))

    lo, hi = 0.0, 0.5
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        s = sum(shin_probs(mid))
        if s > 1.0:
            lo = mid
        else:
            hi = mid
    pa, pb = shin_probs(0.5 * (lo + hi))
    s = pa + pb
    return pa / s, pb / s


def ev_per_unit(p_win: float, p_push: float, american: float) -> Optional[float]:
    """Expected profit per 1 unit staked at ``american`` given win/push probabilities."""
    dec = american_to_decimal(american)
    if dec is None:
        return None
    p_lose = max(0.0, 1.0 - p_win - p_push)
    return p_win * (dec - 1.0) - p_lose


def kelly_fraction(p_win: float, p_push: float, american: float) -> Optional[float]:
    """Full-Kelly stake fraction (pushes refund, so they drop out of the edge)."""
    dec = american_to_decimal(american)
    if dec is None or dec <= 1.0:
        return None
    p_lose = max(0.0, 1.0 - p_win - p_push)
    f = (p_win * (dec - 1.0) - p_lose) / (dec - 1.0)
    return max(0.0, f)


def fair_price_no_push(p_win: float, p_push: float) -> Optional[float]:
    """American price for the win-vs-lose odds once pushes are refunded."""
    denom = p_win + max(0.0, 1.0 - p_win - p_push)
    if denom <= 0:
        return None
    return prob_to_american(p_win / denom)
