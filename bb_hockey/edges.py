"""Book quotes vs the model: every side of every quote gets a fair prob and an EV.

Mapping from BB-Odds's (market_type, period) to our market keys. Hockey
periods in BB-Odds (verified on quoted points, see odds_reader):
``1q``/``1h`` → first period, ``2h`` → second period, ``game`` → full game.
Totals rows carry the OVER on the home side.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from .config import settings
from .model.goals import GameModel
from .model.odds_math import ev_per_unit, fair_price_no_push, kelly_fraction
from .odds_reader import PERIOD_MAP

_MT_KEY = {"h2h": "ml", "spreads": "spread", "totals": "total"}


def market_key(market_type: str, period: str) -> Optional[str]:
    seg = PERIOD_MAP.get(period)
    if seg is None or market_type not in _MT_KEY:
        return None
    if seg == "game":
        return {"h2h": "ml", "spreads": "puck", "totals": "total"}[market_type]
    return f"{seg}_{_MT_KEY[market_type]}"


def _sides(market_type: str, q: dict):
    if market_type == "totals":
        pt = q.get("home_point")
        return [("over", pt, q.get("home_price")), ("under", pt, q.get("away_price"))]
    if market_type == "spreads":
        return [("home", q.get("home_point"), q.get("home_price")), ("away", q.get("away_point"), q.get("away_price"))]
    return [("home", None, q.get("home_price")), ("away", None, q.get("away_price"))]


def evaluate_quotes(model: GameModel, quotes: List[dict]) -> List[dict]:
    """One row per quoted side with fair prob/push, fair price, EV and Kelly."""
    out = []
    for q in quotes:
        mk = market_key(q["market_type"], q["period"])
        if mk is None:
            continue
        for side, point, price in _sides(q["market_type"], q):
            if price is None or (q["market_type"] != "h2h" and point is None):
                continue
            r = model.prob_for(mk, side, point)
            if r is None:
                continue
            p_win, p_push = r
            ev = ev_per_unit(p_win, p_push, price)
            if ev is None:
                continue
            out.append({
                "game_id": q["game_id"], "market": mk, "side": side, "point": point,
                "period_src": q["period"], "sportsbook_id": q["sportsbook_id"], "sportsbook": q["book"],
                "book_group": q.get("book_group"), "price": float(price), "quoted_at": q.get("timestamp"),
                "fair_prob": round(p_win, 5), "push_prob": round(p_push, 5),
                "fair_price": fair_price_no_push(p_win, p_push),
                "ev": round(ev, 5), "kelly": round(kelly_fraction(p_win, p_push, price) or 0.0, 5),
            })
    return out


def positive_edges(rows: List[dict], min_ev: float = 0.0, max_ev: Optional[float] = None) -> List[dict]:
    max_ev = settings.max_edge if max_ev is None else max_ev
    return sorted((r for r in rows if min_ev <= r["ev"] <= max_ev), key=lambda r: -r["ev"])


def best_per_side(rows: List[dict]) -> Dict[tuple, dict]:
    """Highest-EV book for each (market, side, point)."""
    best: Dict[tuple, dict] = {}
    for r in rows:
        k = (r["market"], r["side"], r["point"])
        if k not in best or r["ev"] > best[k]["ev"]:
            best[k] = r
    return best
