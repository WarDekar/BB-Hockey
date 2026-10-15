"""ESPN NHL results: final score, period linescores, OT/SO flags.

Same public site API BB-Odds's ``hockey_detail.py`` reads. ESPN linescores
run [P1, P2, P3, OT?, SO?]: a fourth entry means overtime was played, a
fifth means a shootout (the SO entry is 1 for the winner and the final
score already counts it).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

from .teams import resolve

logger = logging.getLogger(__name__)
BASE = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl"


def _get(url: str, timeout: float = 10.0) -> dict:
    r = requests.get(url, timeout=timeout, headers={"User-Agent": "BB-Hockey/0.1"})
    r.raise_for_status()
    return r.json()


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def parse_competition(comp: dict) -> Optional[dict]:
    status = (comp.get("status") or {}).get("type") or {}
    state = status.get("state")
    sides = {}
    for c in comp.get("competitors") or []:
        team = c.get("team") or {}
        lines = [_int(ls.get("value") if isinstance(ls, dict) else ls) for ls in (c.get("linescores") or [])]
        sides[c.get("homeAway")] = {
            "abbr": team.get("abbreviation"), "name": team.get("displayName"),
            "score": _int(c.get("score")), "lines": lines, "winner": c.get("winner"),
        }
    if "home" not in sides or "away" not in sides:
        return None
    h, a = sides["home"], sides["away"]
    n = max(len(h["lines"]), len(a["lines"]))
    periods = [[h["lines"][i] if i < len(h["lines"]) else 0, a["lines"][i] if i < len(a["lines"]) else 0] for i in range(min(3, n))]
    out = {
        "espn_game_id": _int(comp.get("id")),
        "state": state, "completed": bool(status.get("completed")),
        "detail": status.get("shortDetail") or status.get("detail"),
        "home_abbr": h["abbr"], "away_abbr": a["abbr"],
        "home_score": h["score"], "away_score": a["score"],
        "periods": periods,
        "went_ot": n >= 4, "went_so": n >= 5,
        "reg_home": sum(p[0] or 0 for p in periods) if len(periods) == 3 else None,
        "reg_away": sum(p[1] or 0 for p in periods) if len(periods) == 3 else None,
    }
    return out


def summary(event_id: int) -> Optional[dict]:
    d = _get(f"{BASE}/summary?event={int(event_id)}")
    comps = (d.get("header") or {}).get("competitions") or []
    if not comps:
        return None
    comp = dict(comps[0])
    comp.setdefault("id", (d.get("header") or {}).get("id"))
    return parse_competition(comp)


def scoreboard(day: datetime) -> list:
    d = _get(f"{BASE}/scoreboard?dates={day.strftime('%Y%m%d')}&limit=100")
    out = []
    for e in d.get("events") or []:
        for comp in e.get("competitions") or []:
            comp = dict(comp)
            comp.setdefault("id", e.get("id"))
            comp["_date"] = e.get("date")
            p = parse_competition(comp)
            if p:
                p["date"] = e.get("date")
                out.append(p)
    return out


def find_event(game_time: datetime, home_name: str, away_name: str) -> Optional[dict]:
    """Locate the ESPN event for a BB-Odds game by date (UTC ± a day) and clubs."""
    home, away = resolve(home_name), resolve(away_name)
    if not home or not away:
        return None
    seen = set()
    for delta in (0, -1, 1):
        day = (game_time.astimezone(timezone.utc) + timedelta(days=delta))
        key = day.strftime("%Y%m%d")
        if key in seen:
            continue
        seen.add(key)
        try:
            events = scoreboard(day)
        except Exception as e:  # noqa: BLE001
            logger.warning("espn scoreboard %s failed: %s", key, e)
            continue
        for ev in events:
            if ev["home_abbr"] == home.abbr and ev["away_abbr"] == away.abbr:
                try:
                    when = datetime.fromisoformat(ev["date"].replace("Z", "+00:00"))
                    if abs((when - game_time).total_seconds()) > 36 * 3600:
                        continue
                except Exception:  # noqa: BLE001
                    pass
                return ev
    return None
