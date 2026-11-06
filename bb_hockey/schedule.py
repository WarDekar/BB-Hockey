"""NHL.com as the start-time and live-state truth for the slate (2026-11-05).

BB-Odds's ``current.games`` carries the schedule its feed was given; when the league moves a start (VAN @ WPG
went from 17:07 to 16:00 PT on 2026-11-05) the row keeps the old time and ``started`` stays false, so the
consensus turns in-play while the pricer still treats the game as pregame and marks stale pregame quotes as
edges. Each pricing pass overlays NHL.com's schedule: the start time and whether the game is under way.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from . import nhl

logger = logging.getLogger(__name__)

LIVE_STATES = {"LIVE", "CRIT", "OFF", "FINAL"}
_cache: Dict[str, Tuple[float, List[dict]]] = {}
_lock = threading.Lock()
TTL_S = 120.0


def _week(date: str) -> List[dict]:
    """Every game in the NHL.com schedule week that starts on ``date`` (cached two minutes)."""
    with _lock:
        hit = _cache.get(date)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
    d = nhl.get(f"{nhl.BASE}/schedule/{date}", timeout=10.0, retries=1) or {}
    games = [g for day in d.get("gameWeek", []) for g in day.get("games", [])]
    with _lock:
        _cache[date] = (time.time(), games)
    return games


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def index(now: Optional[datetime] = None) -> Dict[tuple, dict]:
    """{(away_nhl_abbr, home_nhl_abbr): {start, state, id}} for games from yesterday through the coming days."""
    now = now or datetime.now(timezone.utc)
    out: Dict[tuple, dict] = {}
    try:
        for g in _week((now - timedelta(days=1)).strftime("%Y-%m-%d")):
            key = (g["awayTeam"]["abbrev"], g["homeTeam"]["abbrev"])
            row = {"start": _parse(g["startTimeUTC"]), "state": g.get("gameState"), "id": g.get("id")}
            prev = out.get(key)
            # a rematch inside the week: keep the one nearest now
            if prev is None or abs((row["start"] - now).total_seconds()) < abs((prev["start"] - now).total_seconds()):
                out[key] = row
    except Exception as e:  # noqa: BLE001
        logger.warning("NHL.com schedule unavailable, BB-Odds's times stand: %s", e)
    return out


def overlay(game: dict, idx: Dict[tuple, dict], away_abbr: Optional[str], home_abbr: Optional[str],
            now: Optional[datetime] = None) -> dict:
    """Return the slate row with NHL.com's start time and live state applied (pure; ``idx`` from ``index()``)."""
    now = now or datetime.now(timezone.utc)
    g = dict(game)
    row = idx.get((away_abbr, home_abbr)) if away_abbr and home_abbr else None
    if row and abs((row["start"] - g["game_time"]).total_seconds()) <= 12 * 3600:
        if row["start"] != g["game_time"]:
            logger.info("%s @ %s: NHL.com start %s, BB-Odds %s", away_abbr, home_abbr, row["start"], g["game_time"])
            g["game_time"] = row["start"]
        if row["state"] in LIVE_STATES:
            g["started"] = True
        g["nhl_game_id"] = row["id"]
    if g["game_time"] <= now:   # whatever the flags say, a game past its start is not pregame
        g["started"] = True
    return g
