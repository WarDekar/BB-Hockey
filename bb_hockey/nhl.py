"""NHL.com public API client: schedules, play-by-play, shift charts, game info.

Two hosts, no key: ``api-web.nhle.com/v1`` (gamecenter, schedules) and
``api.nhle.com/stats/rest`` (shift charts). Polite by construction: one
session, modest retries, a handful of workers in the backfill.
"""
from __future__ import annotations

import logging
import time
from typing import List, Optional

import requests

logger = logging.getLogger(__name__)
BASE = "https://api-web.nhle.com/v1"
STATS = "https://api.nhle.com/stats/rest/en"
HEADERS = {"User-Agent": "Mozilla/5.0 (BB-Hockey research; contact via repo)"}

# Every club that has played in the backfill window (ARI became UTA in 2024-25).
CLUBS = ["ANA", "ARI", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL",
         "NJD", "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH"]

_session = requests.Session()


def get(url: str, timeout: float = 25.0, retries: int = 4) -> Optional[dict]:
    """GET JSON; None on 404; retries with backoff on 429/5xx/network errors."""
    last: Optional[Exception] = None
    for i in range(retries):
        try:
            r = _session.get(url, timeout=timeout, headers=HEADERS)
            if r.status_code == 404:
                return None
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} for {url}")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"NHL API failed after {retries} tries: {last}")


def club_season_schedule(abbr: str, season: int) -> List[dict]:
    d = get(f"{BASE}/club-schedule-season/{abbr}/{season}")
    return list((d or {}).get("games") or [])


def schedule_day(date: str) -> List[dict]:
    """Games on an ISO date (the endpoint returns the week; keep that day)."""
    d = get(f"{BASE}/schedule/{date}") or {}
    return [g for day in d.get("gameWeek", []) if day.get("date") == date for g in day.get("games", [])]


def play_by_play(game_id: int) -> Optional[dict]:
    return get(f"{BASE}/gamecenter/{game_id}/play-by-play")


def right_rail(game_id: int) -> Optional[dict]:
    return get(f"{BASE}/gamecenter/{game_id}/right-rail")


def shift_charts(game_id: int) -> List[dict]:
    d = get(f"{STATS}/shiftcharts?cayenneExp=gameId={game_id}") or {}
    return list(d.get("data") or [])


def season_game_ids(season: int, game_types=(2, 3)) -> List[dict]:
    """Union of every club's season schedule: [{id, gameType, gameDate, gameState, ...}]."""
    seen = {}
    for abbr in CLUBS:
        try:
            for g in club_season_schedule(abbr, season):
                if g.get("gameType") in game_types:
                    seen[int(g["id"])] = g
        except Exception as e:  # noqa: BLE001
            logger.warning("schedule %s %s failed: %s", abbr, season, e)
    return [seen[k] for k in sorted(seen)]
