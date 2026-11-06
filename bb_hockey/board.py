"""The board the tabs render (every evaluated quote + the slate) and its deltas.

The API serves the whole board once per browser session (``GET /board``); after that the worker emits a
``board`` delta per pricing pass over Socket.IO with only the rows that changed (``edges_upsert`` /
``edges_delete`` / ``slate_upsert`` / ``slate_delete``), numbered ``seq`` under a per-process ``boot`` id so a
client that missed one (reconnect, laptop lid) knows to resync. Rows are keyed by their natural identity
(``key``), not the edges table id, which changes every pass (delete + insert per game).
"""
from __future__ import annotations

import json
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.engine import Engine

from . import pbp
from .config import settings
from .teams import nhl_abbr

# Columns that change every pass without the row meaning anything new.
_EDGE_VOLATILE = ("id", "computed_at", "snapshot_id", "key")
_SLATE_VOLATILE = ("updated_at", "key")


def edge_key(r: dict, n: int = 0) -> str:
    return f"{r['game_id']}|{r.get('period_src')}|{r['market']}|{r['side']}|{r.get('point')}|{r['sportsbook_id']}|{n}"


def _with_keys(rows: List[dict]) -> List[dict]:
    """Attach ``key``; a book quoting the same (market, side, point) twice (Bet105's two line sets) gets 0, 1…"""
    seen: Dict[str, int] = defaultdict(int)
    out = []
    for r in rows:
        base = edge_key(r)
        r = dict(r, key=edge_key(r, seen[base]))
        seen[base] += 1
        out.append(r)
    return out


def edges_rows(engine: Engine, min_ev: Optional[float] = None, limit: Optional[int] = None,
               game_ids: Optional[Iterable[int]] = None) -> List[dict]:
    """Every quote on the pregame board above ``min_ev`` (default: the auto-paper threshold), EV desc, JSON-ready."""
    min_ev = settings.min_edge if min_ev is None else min_ev
    sql = """
        SELECT e.*, g.home_name, g.away_name, g.home_abbr, g.away_abbr, g.home_rotation, g.away_rotation, g.game_time, g.status,
               EXISTS (SELECT 1 FROM paper_bets b WHERE b.game_id = e.game_id AND b.market = e.market AND b.side = e.side
                       AND b.point IS NOT DISTINCT FROM e.point AND b.status <> 'void') AS papered
        FROM edges e JOIN games g ON g.id = e.game_id
        WHERE e.ev >= :min_ev AND g.status = 'pregame' AND g.game_time > now()
          AND e.computed_at > now() - interval '20 minutes'   -- only edges from a pass the current model made
    """
    params: Dict = {"min_ev": min_ev}
    if game_ids is not None:
        sql += " AND e.game_id = ANY(:ids)"
        params["ids"] = [int(g) for g in game_ids]
    sql += " ORDER BY e.ev DESC"
    if limit:
        sql += " LIMIT :lim"
        params["lim"] = int(limit)
    with engine.connect() as c:
        rows = [dict(r) for r in c.execute(text(sql), params).mappings().all()]
    return _with_keys(jsonable_encoder(rows))


def slate_rows(engine: Engine, hours_back: int = 14, hours_ahead: Optional[int] = None) -> List[dict]:
    """The Board tab's rows: games in the window with their live snapshot, edge counts, ledger and bench reads."""
    hours_ahead = hours_ahead or settings.slate_hours_ahead
    now = datetime.now(timezone.utc)
    with engine.connect() as c:
        games = [dict(r) for r in c.execute(text("""
            SELECT g.*, s.id AS snapshot_id, s.computed_at AS priced_at, s.inputs, s.summary,
                   (SELECT count(*) FROM edges e WHERE e.game_id = g.id AND e.ev >= :min_edge) AS n_edges,
                   (SELECT max(ev) FROM edges e WHERE e.game_id = g.id) AS best_ev,
                   (SELECT count(*) FROM paper_bets b WHERE b.game_id = g.id AND b.status <> 'void') AS n_bets,
                   (SELECT COALESCE(sum(pnl), 0) FROM paper_bets b WHERE b.game_id = g.id) AS pnl
            FROM games g
            LEFT JOIN LATERAL (SELECT id, computed_at, inputs, summary FROM pricing_snapshots p
                               WHERE p.game_id = g.id AND p.kind = 'live' ORDER BY computed_at DESC LIMIT 1) s ON true
            WHERE g.game_time BETWEEN :lo AND :hi ORDER BY g.game_time, g.id
        """), {"lo": now - timedelta(hours=hours_back), "hi": now + timedelta(hours=hours_ahead),
               "min_edge": settings.min_edge}).mappings().all()]
    notes = pbp.notes_by_team(engine)
    for g in games:
        g["home_bench"] = notes.get(nhl_abbr(g.get("home_abbr")))
        g["away_bench"] = notes.get(nhl_abbr(g.get("away_abbr")))
    return jsonable_encoder(games)


def _sig(row: dict, volatile: Tuple[str, ...]) -> str:
    return json.dumps({k: v for k, v in row.items() if k not in volatile}, sort_keys=True, default=str)


def compute_delta(prev_edges: Dict[str, str], prev_slate: Dict[int, str], edges: List[dict], slate: List[dict]) -> Tuple[dict, Dict[str, str], Dict[int, str]]:
    """Pure: the rows whose content moved since the previous state and the keys that vanished, plus the new state."""
    e_sig = {r["key"]: _sig(r, _EDGE_VOLATILE) for r in edges}
    s_sig = {int(r["id"]): _sig(r, _SLATE_VOLATILE) for r in slate}
    delta = {
        "edges_upsert": [r for r in edges if prev_edges.get(r["key"]) != e_sig[r["key"]]],
        "edges_delete": [k for k in prev_edges if k not in e_sig],
        "slate_upsert": [r for r in slate if prev_slate.get(int(r["id"])) != s_sig[int(r["id"])]],
        "slate_delete": [g for g in prev_slate if g not in s_sig],
    }
    return delta, e_sig, s_sig


class BoardState:
    """The worker's memory of the last board it emitted. One per process (``BOARD``)."""

    def __init__(self) -> None:
        self.boot = uuid.uuid4().hex[:12]
        self.seq = 0
        self.at: Optional[str] = None
        self._edges: Dict[str, str] = {}
        self._slate: Dict[int, str] = {}
        self._lock = threading.Lock()

    def version(self) -> dict:
        return {"boot": self.boot, "seq": self.seq, "at": self.at}

    def snapshot(self, engine: Engine) -> dict:
        """The whole board for a fresh client. Rows first, version after: a delta emitted while the rows were being
        read is already inside them, and re-applying it on the client is a no-op (upserts carry whole rows)."""
        edges = edges_rows(engine, min_ev=settings.store_min_ev)
        slate = slate_rows(engine)
        return {**self.version(), "edges": edges, "slate": slate}

    def delta(self, engine: Engine) -> Optional[dict]:
        """Diff the board after a pricing pass; None when nothing moved. Bumps ``seq`` only when something did."""
        edges = edges_rows(engine, min_ev=settings.store_min_ev)
        slate = slate_rows(engine)
        with self._lock:
            d, self._edges, self._slate = compute_delta(self._edges, self._slate, edges, slate)
            if not any(d.values()):
                return None
            self.seq += 1
            self.at = datetime.now(timezone.utc).isoformat()
            return {**self.version(), **d}


BOARD = BoardState()
