"""Read-only reads of BB-Odds's `bb_odds` database.

Schema facts (verified 2026-10-15 on kamel):
* ``current`` holds the live slate (purged nightly), ``main`` the history
  (``main.odds`` is a Timescale hypertable — always time-bound reads).
* NHL is ``leagues.name = 'NHL'``; ``markets`` carry ``market_type`` in
  {h2h, spreads, totals} × ``period`` in {game, 1h, 2h, 1q, live}.
* The de-vigged consensus is the synthetic sportsbook ``key =
  'market_consensus'`` (id 413): fair two-way prices at the modal point.
  For totals ``home_*`` is the OVER side (BB-Odds convention).
* Hockey periods: ``1q`` is the FIRST PERIOD (points: spread ±0.5, total
  1.5) and so is ``1h`` from the DonBest-sourced books; ``2h`` is the
  SECOND period (total 2). Inferred from the quoted points, not from
  documentation — see CLAUDE.md "Assumptions".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.engine import Engine

from .config import settings
from .model.odds_math import american_to_prob, prob_to_american

PERIOD_MAP = {"game": "game", "1q": "p1", "1h": "p1", "2h": "p2"}


def _ids(game_ids: Iterable[int]) -> list:
    return [int(g) for g in game_ids]


def consensus_book_id(engine: Engine) -> int:
    with engine.connect() as c:
        row = c.execute(text("SELECT id FROM current.sportsbooks WHERE key='market_consensus' ORDER BY id LIMIT 1")).first()
    return int(row[0]) if row else 413


def slate(engine: Engine, hours_ahead: Optional[int] = None, hours_back: int = 8) -> List[dict]:
    """NHL games in current: from ``hours_back`` ago to ``hours_ahead`` ahead."""
    hours_ahead = hours_ahead or settings.slate_hours_ahead
    now = datetime.now(timezone.utc)
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT g.id, g.external_id, g.espn_game_id, g.game_time, g.status, g.started, g.completed,
                   g.home_score, g.away_score, g.home_rotation, g.away_rotation,
                   ht.name AS home_name, at.name AS away_name, g.home_team_id, g.away_team_id
            FROM current.games g
            JOIN current.leagues l ON l.id = g.league_id
            JOIN current.teams ht ON ht.id = g.home_team_id
            JOIN current.teams at ON at.id = g.away_team_id
            WHERE l.name = 'NHL' AND g.game_time BETWEEN :lo AND :hi
            ORDER BY g.game_time, g.id
        """), {"lo": now - timedelta(hours=hours_back), "hi": now + timedelta(hours=hours_ahead)}).mappings().all()
    return [dict(r) for r in rows]


def game_rows(engine: Engine, game_ids: Iterable[int], schema: str = "current") -> Dict[int, dict]:
    ids = _ids(game_ids)
    if not ids:
        return {}
    with engine.connect() as c:
        rows = c.execute(text(f"""
            SELECT g.id, g.espn_game_id, g.game_time, g.status, g.started, g.completed, g.home_score, g.away_score
            FROM {schema}.games g WHERE g.id = ANY(:ids)
        """), {"ids": ids}).mappings().all()
    return {int(r["id"]): dict(r) for r in rows}


def consensus(engine: Engine, game_ids: Iterable[int], book_id: int = 413) -> Dict[int, Dict[tuple, dict]]:
    """{game_id: {(market_type, period): row}} — the latest consensus row per market."""
    ids = _ids(game_ids)
    if not ids:
        return {}
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT m.game_id, m.market_type, m.period, o.home_price, o.away_price, o.home_point, o.away_point, o.timestamp
            FROM current.odds o JOIN current.markets m ON m.id = o.market_id
            WHERE m.game_id = ANY(:ids) AND o.sportsbook_id = :book
              AND m.market_type IN ('h2h','spreads','totals') AND m.period IN ('game','1q','1h','2h')
        """), {"ids": ids, "book": book_id}).mappings().all()
    out: Dict[int, Dict[tuple, dict]] = {}
    for r in rows:
        out.setdefault(int(r["game_id"]), {})[(r["market_type"], r["period"])] = dict(r)
    return out


def book_quotes(engine: Engine, game_ids: Iterable[int], max_age_min: Optional[int] = None) -> List[dict]:
    """Every live, non-synthetic book quote on the pregame markets we can price.

    Only ``settings.quote_sources`` feeds count: ``donbest_live`` rows are a second copy of books
    OddsLogic carries live (BetOnline 1393 beside 713) and sit 10+ hours stale on a game day, so a
    +174 showed on the board while the live row said +157. ``books_active_only`` adds BB-Odds's own
    rule (``active`` = shown on the operator's grid; what Top Bets, consensus and the edge watcher
    use), which also hides exchanges and per-head books the operator keeps off that grid."""
    ids = _ids(game_ids)
    if not ids:
        return []
    max_age_min = max_age_min or settings.quote_max_age_min
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT m.id AS market_id, m.game_id, m.market_type, m.period, o.sportsbook_id, s.key AS book_key, s.name AS book,
                   s.book_group, s.consensus_enabled, o.home_price, o.away_price, o.home_point, o.away_point, o.timestamp
            FROM current.odds o
            JOIN current.markets m ON m.id = o.market_id
            JOIN current.sportsbooks s ON s.id = o.sportsbook_id
            WHERE m.game_id = ANY(:ids)
              AND m.market_type IN ('h2h','spreads','totals') AND m.period IN ('game','1q','1h','2h')
              AND s.source = ANY(:sources)
              AND (CAST(:active_only AS boolean) = false OR s.active IS TRUE)
              AND COALESCE(s.is_synthetic, false) = false
              AND COALESCE(s.uses_live_markets_only, false) = false
              AND o.timestamp >= :since
        """), {"ids": ids, "since": datetime.now(timezone.utc) - timedelta(minutes=max_age_min),
               "sources": list(settings.quote_sources), "active_only": bool(settings.books_active_only)}).mappings().all()
    out = [dict(r) for r in rows]
    return _takeable(out, poly_asks(engine, ids))


def poly_asks(engine: Engine, game_ids: Iterable[int]) -> Dict[tuple, dict]:
    """Polymarket asks (what a taker pays) keyed by (BB-Odds market id, home point): a BB-Odds market is one
    (game, type, period) and the line lives on the odds row, so each Polymarket line maps separately. Spread
    rows come oriented by ``yes_outcome_team``; the home point is the line when the yes side is home, else its negative."""
    ids = _ids(game_ids)
    if not ids:
        return {}
    try:
        with engine.connect() as c:
            rows = c.execute(text("""
                SELECT pm.bb_odds_market_id AS market_id, pm.market_type, pm.line, pm.yes_outcome_team,
                       pm.home_american_ask, pm.away_american_ask, pm.updated_at
                FROM bb_poly.poly_markets pm JOIN current.markets m ON m.id = pm.bb_odds_market_id
                WHERE m.game_id = ANY(:ids) AND NOT pm.closed AND pm.home_american_ask IS NOT NULL AND pm.away_american_ask IS NOT NULL
            """), {"ids": ids}).mappings().all()
    except Exception as e:  # noqa: BLE001
        logger.warning("poly asks unavailable: %s", e)
        return {}
    out: Dict[tuple, dict] = {}
    for r in rows:
        line = float(r["line"]) if r["line"] is not None else None
        if r["market_type"] == "spread" and line is not None:
            home_point = line if (r["yes_outcome_team"] or "home") == "home" else -line
        else:
            home_point = line
        key = (int(r["market_id"]), home_point)
        if key not in out or (r["updated_at"] and out[key]["updated_at"] and r["updated_at"] > out[key]["updated_at"]):
            out[key] = dict(r)
    return out


def _worsen(price: Optional[float], haircut: float) -> Optional[float]:
    """Move an American price against the bettor by ``haircut`` probability points."""
    if price is None:
        return None
    p = american_to_prob(float(price))
    p2 = min(0.99, p + haircut)
    return prob_to_american(p2)


def _takeable(quotes: List[dict], asks: Dict[int, dict]) -> List[dict]:
    """Exchange rows in BB-Odds are mids: replace with the ask when BB-Poly has it, else a haircut. Keeps the quote."""
    for q in quotes:
        q["price_basis"] = "book"
        if q.get("book") not in settings.exchange_mid_books:
            continue
        q["home_price_quoted"], q["away_price_quoted"] = q.get("home_price"), q.get("away_price")
        hp = float(q["home_point"]) if q.get("home_point") is not None else None
        a = asks.get((int(q["market_id"]), hp)) if q.get("market_id") is not None and q.get("book") == "Polymarket" else None
        # sanity: an ask can only be worse for the taker than the mid; anything else is a mapping or staleness problem
        if a and (american_to_prob(float(a["home_american_ask"])) < american_to_prob(float(q["home_price"])) - 0.002
                  or american_to_prob(float(a["away_american_ask"])) < american_to_prob(float(q["away_price"])) - 0.002):
            a = None
        if a:
            q["home_price"], q["away_price"], q["price_basis"] = float(a["home_american_ask"]), float(a["away_american_ask"]), "ask"
        else:
            q["home_price"], q["away_price"], q["price_basis"] = _worsen(q.get("home_price"), settings.exchange_haircut_prob), _worsen(q.get("away_price"), settings.exchange_haircut_prob), "mid-haircut"
    return quotes


def closing_consensus(engine: Engine, game_id: int, game_time: datetime, book_id: int = 413) -> Dict[tuple, dict]:
    """Last consensus row per (market_type, period) around the start, from main.odds.

    Same bounds as BB-Odds's ``closing_line.py``: the consensus writer locks
    at the real start, so the last row within +grace is the close.
    """
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT DISTINCT ON (m.market_type, m.period)
                   m.market_type, m.period, o.home_price, o.away_price, o.home_point, o.away_point, o.timestamp
            FROM main.odds o JOIN main.markets m ON m.id = o.market_id
            WHERE m.game_id = :gid AND o.sportsbook_id = :book
              AND m.market_type IN ('h2h','spreads','totals') AND m.period IN ('game','1q','1h','2h')
              AND o.timestamp >= :lo AND o.timestamp <= :hi
            ORDER BY m.market_type, m.period, o.timestamp DESC
        """), {"gid": int(game_id), "book": book_id,
               "lo": game_time - timedelta(hours=settings.close_lookback_h),
               "hi": game_time + timedelta(minutes=settings.close_grace_min)}).mappings().all()
    return {(r["market_type"], r["period"]): dict(r) for r in rows}


def closing_book_quote(engine: Engine, game_id: int, market_type: str, period: str, sportsbook_id: int,
                       game_time: datetime, home_point: Optional[float]) -> Optional[dict]:
    """The same book's last pre-start quote on the same market and point (for price CLV)."""
    with engine.connect() as c:
        row = c.execute(text("""
            SELECT o.home_price, o.away_price, o.home_point, o.away_point, o.timestamp
            FROM main.odds o JOIN main.markets m ON m.id = o.market_id
            WHERE m.game_id = :gid AND m.market_type = :mt AND m.period = :p AND o.sportsbook_id = :book
              AND o.timestamp >= :lo AND o.timestamp <= :hi
              AND (CAST(:pt AS float8) IS NULL OR o.home_point = CAST(:pt AS float8))
            ORDER BY o.timestamp DESC LIMIT 1
        """), {"gid": int(game_id), "mt": market_type, "p": period, "book": int(sportsbook_id),
               "lo": game_time - timedelta(hours=settings.close_lookback_h),
               "hi": game_time + timedelta(minutes=settings.close_grace_min), "pt": home_point}).mappings().first()
    return dict(row) if row else None


def sportsbook_names(engine: Engine) -> Dict[int, dict]:
    with engine.connect() as c:
        rows = c.execute(text("SELECT id, key, name, book_group, is_synthetic FROM current.sportsbooks")).mappings().all()
    return {int(r["id"]): dict(r) for r in rows}


def espn_teams(engine: Engine, league: str = "nhl") -> List[dict]:
    """BB-Odds's ESPN identity rows for a league: abbreviation, display name, logo URL, colours.
    The fleet's team-identity source (BB-Futures ADR-002): logos are resolved at read time, never stored here."""
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT abbreviation, display_name, short_display_name, location, logo_url, color, alternate_color
            FROM current.espn_teams WHERE lower(league) = :lg OR lower(sport) = 'hockey' ORDER BY abbreviation
        """), {"lg": league.lower()}).mappings().all()
    return [dict(r) for r in rows]
