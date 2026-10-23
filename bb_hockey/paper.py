"""The paper desk: auto-paper the best price on every qualifying edge, manual adds, ledger, P&L."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from .config import settings
from .edges import best_per_side
from .model.odds_math import american_to_decimal

BANKROLL_UNITS = 100.0
AUTO_EXCLUDED_MARKETS = {"ml"}  # the ML is the model's input; a book off the consensus is BB-Odds's job


def auto_excluded(row: dict) -> bool:
    """True when ``settings.auto_paper_exclude`` names this book for this market (``Book:market`` or ``Book:*``)."""
    book = row.get("sportsbook")
    return f"{book}:{row.get('market')}" in settings.auto_paper_exclude or f"{book}:*" in settings.auto_paper_exclude


def stake_units(kelly_full: float) -> float:
    return round(min(settings.max_stake_units, max(0.0, kelly_full * settings.kelly_fraction * BANKROLL_UNITS)), 3)


def auto_paper(c: Connection, game: dict, rows: List[dict], snapshot_id: int) -> List[dict]:
    if not settings.auto_paper or game.get("status") != "pregame":
        return []
    if game["game_time"] <= datetime.now(timezone.utc):
        return []
    placed = []
    existing = {(r[0], r[1], r[2]) for r in c.execute(text(
        "SELECT market, side, point FROM paper_bets WHERE game_id = :g AND status <> 'void'"), {"g": game["id"]})}
    for (market, side, point), r in best_per_side([r for r in rows if not auto_excluded(r)]).items():
        if market in AUTO_EXCLUDED_MARKETS or not (settings.min_edge <= r["ev"] <= settings.max_edge):
            continue
        if (market, side, point) in existing:
            continue
        units = stake_units(r["kelly"])
        if units <= 0:
            continue
        row = c.execute(text("""
            INSERT INTO paper_bets (game_id, market, side, point, sportsbook_id, sportsbook, price, stake,
                                    fair_prob, push_prob, ev, kelly, source, snapshot_id)
            VALUES (:g, :m, :s, :pt, :bid, :b, :pr, :st, :fp, :pp, :ev, :k, 'auto', :sid)
            ON CONFLICT DO NOTHING RETURNING id
        """), {"g": game["id"], "m": market, "s": side, "pt": point, "bid": r["sportsbook_id"], "b": r["sportsbook"],
               "pr": r["price"], "st": units * settings.unit, "fp": r["fair_prob"], "pp": r["push_prob"],
               "ev": r["ev"], "k": r["kelly"], "sid": snapshot_id}).first()
        if row:
            placed.append({"id": int(row[0]), "game_id": game["id"], "market": market, "side": side, "point": point,
                           "sportsbook": r["sportsbook"], "price": r["price"], "stake": units * settings.unit, "ev": r["ev"]})
            existing.add((market, side, point))
    return placed


def place_manual(engine: Engine, game_id: int, market: str, side: str, point: Optional[float], sportsbook: str,
                 price: float, stake: float, fair_prob: float, push_prob: float, ev: float, kelly: Optional[float],
                 snapshot_id: Optional[int], note: Optional[str] = None, sportsbook_id: Optional[int] = None) -> int:
    with engine.begin() as c:
        row = c.execute(text("""
            INSERT INTO paper_bets (game_id, market, side, point, sportsbook_id, sportsbook, price, stake, fair_prob,
                                    push_prob, ev, kelly, source, snapshot_id, note)
            VALUES (:g, :m, :s, :pt, :bid, :b, :pr, :st, :fp, :pp, :ev, :k, 'manual', :sid, :n) RETURNING id
        """), {"g": game_id, "m": market, "s": side, "pt": point, "bid": sportsbook_id, "b": sportsbook, "pr": price,
               "st": stake, "fp": fair_prob, "pp": push_prob, "ev": ev, "k": kelly, "sid": snapshot_id, "n": note}).first()
    return int(row[0])


def void_bet(engine: Engine, bet_id: int) -> bool:
    with engine.begin() as c:
        n = c.execute(text("UPDATE paper_bets SET status='void', pnl=0, settled_at=now() WHERE id=:i AND status='pending'"),
                      {"i": bet_id}).rowcount
    return n > 0


def pnl_for(status: str, stake: float, price: float) -> float:
    if status == "won":
        return round(stake * (american_to_decimal(price) - 1.0), 2)
    if status == "lost":
        return round(-stake, 2)
    return 0.0


def ledger(engine: Engine, status: Optional[str] = None, limit: int = 500) -> List[dict]:
    q = """
        SELECT b.*, g.home_name, g.away_name, g.home_abbr, g.away_abbr, g.home_rotation, g.away_rotation, g.game_time, g.final_home, g.final_away,
               g.status AS game_status
        FROM paper_bets b JOIN games g ON g.id = b.game_id
    """
    params: Dict = {"lim": limit}
    if status:
        q += " WHERE b.status = :st"
        params["st"] = status
    q += " ORDER BY b.placed_at DESC LIMIT :lim"
    with engine.connect() as c:
        return [dict(r) for r in c.execute(text(q), params).mappings().all()]


def summary(engine: Engine) -> dict:
    """Totals over the ledger less flagged bets (``flag`` set: placed on a quote that was never live, e.g. a
    donbest_live copy of a book); those are counted separately under ``flagged`` so the ROI is honest."""
    with engine.connect() as c:
        tot = c.execute(text("""
            SELECT count(*) FILTER (WHERE status='pending') AS pending,
                   count(*) FILTER (WHERE status IN ('won','lost','push')) AS settled,
                   count(*) FILTER (WHERE status='won') AS won,
                   count(*) FILTER (WHERE status='lost') AS lost,
                   count(*) FILTER (WHERE status='push') AS pushed,
                   COALESCE(sum(stake) FILTER (WHERE status IN ('won','lost','push')), 0) AS staked,
                   COALESCE(sum(pnl), 0) AS pnl,
                   avg(clv_model) FILTER (WHERE clv_model IS NOT NULL) AS avg_clv_model,
                   avg(clv_price) FILTER (WHERE clv_price IS NOT NULL) AS avg_clv_price,
                   count(*) FILTER (WHERE clv_model > 0) AS clv_model_pos,
                   count(*) FILTER (WHERE clv_model IS NOT NULL) AS clv_model_n,
                   avg(ev) FILTER (WHERE status <> 'void') AS avg_ev
            FROM paper_bets WHERE flag IS NULL
        """)).mappings().first()
        flagged = c.execute(text("""
            SELECT count(*) AS n, COALESCE(sum(pnl), 0) AS pnl, count(*) FILTER (WHERE status = 'void') AS voided
            FROM paper_bets WHERE flag IS NOT NULL
        """)).mappings().first()
        by_market = c.execute(text("""
            SELECT market, count(*) AS n,
                   count(*) FILTER (WHERE status='won') AS won,
                   count(*) FILTER (WHERE status='lost') AS lost,
                   COALESCE(sum(stake) FILTER (WHERE status IN ('won','lost','push')), 0) AS staked,
                   COALESCE(sum(pnl), 0) AS pnl,
                   avg(clv_model) FILTER (WHERE clv_model IS NOT NULL) AS avg_clv_model,
                   avg(ev) AS avg_ev
            FROM paper_bets WHERE status <> 'void' AND flag IS NULL GROUP BY market ORDER BY market
        """)).mappings().all()
    out = dict(tot)
    out["flagged"] = dict(flagged)   # bets on quotes that were never live (flag = 'stale_feed'); outside every total above
    out["roi"] = (out["pnl"] / out["staked"]) if out["staked"] else None
    out["by_market"] = [dict(r) for r in by_market]
    return out
