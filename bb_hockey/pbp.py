"""NHL play-by-play ingest and goalie-pull derivation.

Per final: play-by-play (events, situation codes, running score), shift
charts (who was on the ice when), right-rail (head coaches). Raw JSON is kept
gzipped under ``data/nhl/<season>/`` so the derived tables can be rebuilt
without refetching.

Goalie-pull episodes come from the goalie shifts: inside a period, any gap
with no goalie of that team on the ice is an episode. Play-by-play situation
codes (away goalie, away skaters, home skaters, home goalie) are the fallback
when the shift chart is missing. Score at the pull, goals during it and how it
ended are read off the goal events.

CLI::

    ./.venv/bin/python -m bb_hockey.pbp backfill 20232024 20242025 20252026 20262027
    ./.venv/bin/python -m bb_hockey.pbp game 2026020138
    ./.venv/bin/python -m bb_hockey.pbp recent
    ./.venv/bin/python -m bb_hockey.pbp coaches      # rebuild the coaches table from nhl_games
"""
from __future__ import annotations

import gzip
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from . import nhl
from .config import REPO

logger = logging.getLogger(__name__)
RAW = REPO / "data" / "nhl"


# ----------------------------------------------------------------------------- helpers
def mmss(s: Optional[str]) -> int:
    if not s:
        return 0
    m, sec = s.split(":")
    return int(m) * 60 + int(sec)


def period_len(period: int, reg_periods: int, game_type: int) -> int:
    return 1200 if period <= reg_periods or game_type == 3 else 300


def _raw_path(season: int, gid: int, kind: str) -> Path:
    return RAW / str(season) / f"{gid}.{kind}.json.gz"


def save_raw(season: int, gid: int, kind: str, obj) -> None:
    p = _raw_path(season, gid, kind)
    p.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(p, "wt", encoding="utf-8") as f:
        json.dump(obj, f)


def load_raw(season: int, gid: int, kind: str):
    p = _raw_path(season, gid, kind)
    if not p.exists():
        return None
    with gzip.open(p, "rt", encoding="utf-8") as f:
        return json.load(f)


# ----------------------------------------------------------------------------- parsing
def parse_plays(pbp: dict) -> List[dict]:
    """Flat play rows with the running score after each event."""
    away, home = 0, 0
    rows = []
    for p in sorted(pbp.get("plays") or [], key=lambda x: x.get("sortOrder", 0)):
        pd = p.get("periodDescriptor") or {}
        det = p.get("details") or {}
        if p.get("typeDescKey") == "goal":
            away, home = int(det.get("awayScore", away)), int(det.get("homeScore", home))
        rows.append({
            "event_id": int(p["eventId"]), "sort_order": int(p.get("sortOrder", 0)),
            "period": int(pd.get("number", 1)), "period_type": pd.get("periodType") or "REG",
            "elapsed_s": mmss(p.get("timeInPeriod")), "remaining_s": mmss(p.get("timeRemaining")) if p.get("timeRemaining") else None,
            "type_code": p.get("typeCode"), "type": p.get("typeDescKey") or "?",
            "situation_code": p.get("situationCode"), "owner_team_id": det.get("eventOwnerTeamId"),
            "away_score": away, "home_score": home, "details": det or None,
        })
    return rows


def parse_shifts(shifts: List[dict], goalie_ids: set) -> List[dict]:
    rows = []
    for s in shifts:
        if s.get("typeCode") not in (None, 517):   # 505 rows are goal markers, not shifts
            continue
        if s.get("startTime") is None or s.get("endTime") is None:
            continue
        rows.append({
            "shift_id": int(s["id"]), "player_id": int(s["playerId"]),
            "player_name": f"{s.get('firstName', '')} {s.get('lastName', '')}".strip(),
            "team_abbr": s.get("teamAbbrev"), "is_goalie": int(s["playerId"]) in goalie_ids,
            "period": int(s.get("period") or 1), "start_s": mmss(s["startTime"]), "end_s": mmss(s["endTime"]),
        })
    return rows


def _goalie_off_from_shifts(shifts: List[dict], team: str, periods: List[Tuple[int, int, str]]) -> List[Tuple[int, int, int]]:
    """[(period, start_s, end_s)] with no goalie of `team` on the ice, per period."""
    out = []
    for period, plen, ptype in periods:
        if ptype == "SO":
            continue
        ivs = sorted((s["start_s"], s["end_s"]) for s in shifts if s["is_goalie"] and s["team_abbr"] == team and s["period"] == period)
        if not ivs:
            continue  # no goalie shifts recorded this period: cannot tell, skip
        merged: List[List[int]] = []
        for a, b in ivs:
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        cur = 0
        for a, b in merged:
            if a > cur:
                out.append((period, cur, a))
            cur = max(cur, b)
        if cur < plen:
            out.append((period, cur, plen))
    return [(p, a, min(b, l)) for p, a, b in out for q, l, _ in periods if q == p and a < min(b, l)]


def _goalie_off_from_pbp(plays: List[dict], is_home: bool, periods: List[Tuple[int, int, str]]) -> List[Tuple[int, int, int]]:
    """Fallback: consecutive events whose situation code shows this team's goalie out."""
    idx = 3 if is_home else 0
    out = []
    plen = {p: n for p, n, _ in periods}
    for period, _, ptype in periods:
        if ptype == "SO":
            continue
        start = None
        for p in [x for x in plays if x["period"] == period]:
            code = p.get("situation_code")
            if not code or len(code) != 4:
                continue
            off = code[idx] == "0"
            if off and start is None:
                start = p["elapsed_s"]
            elif not off and start is not None:
                if p["elapsed_s"] > start:
                    out.append((period, start, p["elapsed_s"]))
                start = None
        if start is not None:
            out.append((period, start, plen[period]))
    return out


def derive_pulls(game: dict, plays: List[dict], shifts: List[dict]) -> Tuple[List[dict], str]:
    reg = int(game["reg_periods"] or 3)
    gtype = int(game["game_type"])
    max_p = max([p["period"] for p in plays] or [reg])
    periods = [(n, period_len(n, reg, gtype), "REG" if n <= reg else ("SO" if (game["went_so"] and n == max_p) else "OT")) for n in range(1, max_p + 1)]
    # The last period ends when the game does (an OT winner at 19:29 is not followed by 31 s of empty net).
    last_elapsed = max([p["elapsed_s"] for p in plays if p["period"] == max_p] or [0])
    if last_elapsed and periods[-1][2] != "SO":
        periods[-1] = (max_p, min(periods[-1][1], last_elapsed), periods[-1][2])
    goals = [p for p in plays if p["type"] == "goal"]
    penalties = [p for p in plays if p["type"] in ("penalty", "delayed-penalty")]
    have_shifts = any(s["is_goalie"] for s in shifts)
    source = "shifts" if have_shifts else "pbp"
    out = []
    for is_home in (True, False):
        team = game["home_abbr"] if is_home else game["away_abbr"]
        opp = game["away_abbr"] if is_home else game["home_abbr"]
        gaps = _goalie_off_from_shifts(shifts, team, periods) if have_shifts else _goalie_off_from_pbp(plays, is_home, periods)
        n = 0
        for period, a, b in sorted(gaps):
            if b - a < 1:
                continue
            plen = dict((p, l) for p, l, _ in periods)[period]
            ptype = [t for p, _, t in periods if p == period][0]
            before = [g for g in goals if (g["period"], g["elapsed_s"]) < (period, a)]
            sf = (before[-1]["home_score"] if is_home else before[-1]["away_score"]) if before else 0
            sa = (before[-1]["away_score"] if is_home else before[-1]["home_score"]) if before else 0
            during = [g for g in goals if g["period"] == period and a <= g["elapsed_s"] <= b]
            gf = sum(1 for g in during if _scored_by(g, game, is_home))
            ga = len(during) - gf
            deficit = sa - sf
            remaining = (reg - period) * 1200 + (plen - a) if ptype == "REG" else plen - a
            near_penalty = any(p["period"] == period and a - 2 <= p["elapsed_s"] <= b + 3 for p in penalties)
            if a == 0:
                kind = "other"          # goalie absent from the start of a period: a swap or data gap, not a pull
            elif ptype == "OT":
                kind = "ot"
            elif near_penalty and b - a <= 15 and not during:
                kind = "delayed_penalty"
            elif deficit >= 1 and remaining <= 600 and (remaining <= 360 or b - a >= 20):
                kind = "pull"           # nobody pulls with more than ten minutes left; earlier gaps are swaps or data gaps
            else:
                kind = "other"
            ended_by = "period_end" if b >= plen else ("goal_for" if during and _scored_by(during[-1], game, is_home) and during[-1]["elapsed_s"] == b
                                                      else "goal_against" if during and during[-1]["elapsed_s"] == b else "returned")
            n += 1
            out.append({
                "team_abbr": team, "is_home": is_home, "coach": game["home_coach"] if is_home else game["away_coach"],
                "opp_abbr": opp, "opp_coach": game["away_coach"] if is_home else game["home_coach"],
                "episode_no": n, "kind": kind, "source": source, "period": period, "period_type": ptype,
                "pull_elapsed_s": a, "pull_remaining_s": remaining, "end_elapsed_s": b, "duration_s": b - a, "ended_by": ended_by,
                "score_for": sf, "score_against": sa, "deficit": deficit, "goals_for": gf, "goals_against": ga,
                "final_for": game["home_score"] if is_home else game["away_score"], "final_against": game["away_score"] if is_home else game["home_score"],
                "reg_for": game["reg_home"] if is_home else game["reg_away"], "reg_against": game["reg_away"] if is_home else game["reg_home"],
                "went_ot": bool(game["went_ot"]),
            })
    return out, source


def _scored_by(goal: dict, game: dict, is_home: bool) -> bool:
    owner = goal.get("owner_team_id")
    if owner is not None:
        return int(owner) == int(game["home_id"] if is_home else game["away_id"])
    return False


def parse_game(pbp: dict, shifts: List[dict], rail: Optional[dict]) -> Tuple[dict, List[dict], List[dict]]:
    home, away = pbp["homeTeam"], pbp["awayTeam"]
    plays = parse_plays(pbp)
    goalie_ids = {int(r["playerId"]) for r in pbp.get("rosterSpots") or [] if r.get("positionCode") == "G"}
    shift_rows = parse_shifts(shifts, goalie_ids)
    reg = int(pbp.get("regPeriods") or 3)
    pd = pbp.get("periodDescriptor") or {}
    last_period = int(pd.get("number") or max([p["period"] for p in plays] or [reg]))
    last_type = pd.get("periodType") or ("REG" if last_period <= reg else "OT")
    went_so = last_type == "SO"
    went_ot = last_period > reg
    # Regulation score: score after the last regulation event.
    reg_plays = [p for p in plays if p["period"] <= reg]
    reg_away, reg_home = (reg_plays[-1]["away_score"], reg_plays[-1]["home_score"]) if reg_plays else (0, 0)
    info = ((rail or {}).get("gameInfo") or {})
    game = {
        "id": int(pbp["id"]), "season": int(pbp["season"]), "game_type": int(pbp["gameType"]),
        "game_date": pbp["gameDate"], "start_utc": pbp.get("startTimeUTC"),
        "home_abbr": home["abbrev"], "away_abbr": away["abbrev"], "home_id": int(home["id"]), "away_id": int(away["id"]),
        "home_score": int(home.get("score") or 0), "away_score": int(away.get("score") or 0),
        "reg_home": reg_home, "reg_away": reg_away, "reg_periods": reg, "went_ot": went_ot, "went_so": went_so,
        "state": pbp.get("gameState"),
        "home_coach": ((info.get("homeTeam") or {}).get("headCoach") or {}).get("default"),
        "away_coach": ((info.get("awayTeam") or {}).get("headCoach") or {}).get("default"),
        "n_plays": len(plays), "n_shifts": len(shift_rows),
    }
    return game, plays, shift_rows


# ----------------------------------------------------------------------------- storage
def write_game(c: Connection, game: dict, plays: List[dict], shifts: List[dict], pulls: List[dict], source: str) -> None:
    c.execute(text("""
        INSERT INTO nhl_games (id, season, game_type, game_date, start_utc, home_abbr, away_abbr, home_id, away_id,
                               home_score, away_score, reg_home, reg_away, reg_periods, went_ot, went_so, state,
                               home_coach, away_coach, n_plays, n_shifts, pull_source, ingested_at, error)
        VALUES (:id, :season, :game_type, :game_date, :start_utc, :home_abbr, :away_abbr, :home_id, :away_id,
                :home_score, :away_score, :reg_home, :reg_away, :reg_periods, :went_ot, :went_so, :state,
                :home_coach, :away_coach, :n_plays, :n_shifts, :src, now(), NULL)
        ON CONFLICT (id) DO UPDATE SET
            season=EXCLUDED.season, game_type=EXCLUDED.game_type, game_date=EXCLUDED.game_date, start_utc=EXCLUDED.start_utc,
            home_abbr=EXCLUDED.home_abbr, away_abbr=EXCLUDED.away_abbr, home_id=EXCLUDED.home_id, away_id=EXCLUDED.away_id,
            home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, reg_home=EXCLUDED.reg_home, reg_away=EXCLUDED.reg_away,
            reg_periods=EXCLUDED.reg_periods, went_ot=EXCLUDED.went_ot, went_so=EXCLUDED.went_so, state=EXCLUDED.state,
            home_coach=EXCLUDED.home_coach, away_coach=EXCLUDED.away_coach, n_plays=EXCLUDED.n_plays, n_shifts=EXCLUDED.n_shifts,
            pull_source=EXCLUDED.pull_source, ingested_at=now(), error=NULL
    """), dict(game, src=source))
    gid = game["id"]
    for t in ("nhl_plays", "nhl_shifts", "goalie_pulls"):
        c.execute(text(f"DELETE FROM {t} WHERE game_id = :g"), {"g": gid})
    if plays:
        c.execute(text("""
            INSERT INTO nhl_plays (game_id, event_id, sort_order, period, period_type, elapsed_s, remaining_s, type_code, type,
                                   situation_code, owner_team_id, away_score, home_score, details)
            VALUES (:g, :event_id, :sort_order, :period, :period_type, :elapsed_s, :remaining_s, :type_code, :type,
                    :situation_code, :owner_team_id, :away_score, :home_score, CAST(:details AS jsonb))
            ON CONFLICT DO NOTHING
        """), [dict(p, g=gid, details=json.dumps(p["details"]) if p["details"] else None) for p in plays])
    if shifts:
        c.execute(text("""
            INSERT INTO nhl_shifts (game_id, shift_id, player_id, player_name, team_abbr, is_goalie, period, start_s, end_s)
            VALUES (:g, :shift_id, :player_id, :player_name, :team_abbr, :is_goalie, :period, :start_s, :end_s)
            ON CONFLICT DO NOTHING
        """), [dict(s, g=gid) for s in shifts])
    if pulls:
        c.execute(text("""
            INSERT INTO goalie_pulls (game_id, season, game_type, game_date, team_abbr, is_home, coach, opp_abbr, opp_coach, episode_no,
                                      kind, source, period, period_type, pull_elapsed_s, pull_remaining_s, end_elapsed_s, duration_s, ended_by,
                                      score_for, score_against, deficit, goals_for, goals_against, final_for, final_against, reg_for, reg_against, went_ot)
            VALUES (:g, :season, :game_type, :game_date, :team_abbr, :is_home, :coach, :opp_abbr, :opp_coach, :episode_no,
                    :kind, :source, :period, :period_type, :pull_elapsed_s, :pull_remaining_s, :end_elapsed_s, :duration_s, :ended_by,
                    :score_for, :score_against, :deficit, :goals_for, :goals_against, :final_for, :final_against, :reg_for, :reg_against, :went_ot)
        """), [dict(p, g=gid, season=game["season"], game_type=game["game_type"], game_date=game["game_date"]) for p in pulls])


def mark_error(engine: Engine, gid: int, meta: dict, err: str) -> None:
    with engine.begin() as c:
        c.execute(text("""
            INSERT INTO nhl_games (id, season, game_type, game_date, home_abbr, away_abbr, state, error)
            VALUES (:id, :season, :gt, :d, :h, :a, :st, :e)
            ON CONFLICT (id) DO UPDATE SET error = EXCLUDED.error, state = EXCLUDED.state
        """), {"id": gid, "season": int(meta.get("season") or str(gid)[:4] + str(int(str(gid)[:4]) + 1)), "gt": int(meta.get("gameType") or int(str(gid)[4:6])),
               "d": meta.get("gameDate") or date.today().isoformat(), "h": (meta.get("homeTeam") or {}).get("abbrev") or "?",
               "a": (meta.get("awayTeam") or {}).get("abbrev") or "?", "st": meta.get("gameState"), "e": err[:500]})


# ----------------------------------------------------------------------------- ingest
def fetch_game(gid: int, season: Optional[int] = None, use_cache: bool = True) -> Tuple[dict, List[dict], Optional[dict]]:
    season = season or int(str(gid)[:4] + str(int(str(gid)[:4]) + 1))
    pbp = load_raw(season, gid, "pbp") if use_cache else None
    shifts = load_raw(season, gid, "shifts") if use_cache else None
    rail = load_raw(season, gid, "rail") if use_cache else None
    if pbp is None:
        pbp = nhl.play_by_play(gid)
        if pbp is None:
            raise RuntimeError("no play-by-play")
        save_raw(season, gid, "pbp", pbp)
    if not shifts:
        shifts = nhl.shift_charts(gid)
        if shifts:
            save_raw(season, gid, "shifts", shifts)
    if rail is None:
        rail = nhl.right_rail(gid)
        if rail is not None:
            save_raw(season, gid, "rail", rail)
    return pbp, shifts or [], rail


def ingest_game(engine: Engine, gid: int, season: Optional[int] = None, use_cache: bool = True) -> dict:
    pbp, shifts, rail = fetch_game(gid, season, use_cache)
    if pbp.get("gameState") not in ("OFF", "FINAL"):
        raise RuntimeError(f"not final ({pbp.get('gameState')})")
    game, plays, shift_rows = parse_game(pbp, shifts, rail)
    pulls, source = derive_pulls(game, plays, shift_rows)
    with engine.begin() as c:
        write_game(c, game, plays, shift_rows, pulls, source)
    return {"id": gid, "score": f"{game['away_abbr']} {game['away_score']} @ {game['home_abbr']} {game['home_score']}",
            "plays": len(plays), "shifts": len(shift_rows), "pulls": [p for p in pulls if p["kind"] == "pull"], "source": source,
            "coaches": (game["away_coach"], game["home_coach"])}


def ingested_ids(engine: Engine) -> set:
    with engine.connect() as c:
        return {int(r[0]) for r in c.execute(text("SELECT id FROM nhl_games WHERE ingested_at IS NOT NULL AND error IS NULL"))}


def backfill(engine: Engine, seasons: List[int], workers: int = 6, game_types=(2, 3), refetch: bool = False) -> dict:
    done = ingested_ids(engine)
    todo: List[dict] = []
    for season in seasons:
        games = nhl.season_game_ids(season, game_types)
        finals = [g for g in games if g.get("gameState") in ("OFF", "FINAL")]
        todo.extend(g for g in finals if refetch or int(g["id"]) not in done)
        logger.info("season %s: %d games, %d final, %d to ingest", season, len(games), len(finals), sum(1 for g in finals if refetch or int(g["id"]) not in done))
    ok, failed = 0, 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(ingest_game, engine, int(g["id"]), int(g["season"]), not refetch): g for g in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            g = futs[fut]
            try:
                r = fut.result(); ok += 1
                if i % 100 == 0 or i == len(todo):
                    logger.info("backfill %d/%d (%d failed) last: %s %s pulls=%d", i, len(todo), failed, r["id"], r["score"], len(r["pulls"]))
            except Exception as e:  # noqa: BLE001
                failed += 1
                logger.warning("ingest %s failed: %s", g["id"], e)
                try:
                    mark_error(engine, int(g["id"]), g, str(e))
                except Exception:  # noqa: BLE001
                    pass
    rebuild_coaches(engine)
    return {"todo": len(todo), "ok": ok, "failed": failed}


def ingest_recent(engine: Engine, days_back: int = 2) -> dict:
    """Worker job: ingest any final from the last few days not yet stored; retry errored ones."""
    done = ingested_ids(engine)
    today = datetime.now(timezone.utc).date()
    cands: Dict[int, dict] = {}
    for d in range(days_back + 1):
        for g in nhl.schedule_day((today - timedelta(days=d)).isoformat()):
            if g.get("gameType") in (2, 3) and g.get("gameState") in ("OFF", "FINAL") and int(g["id"]) not in done:
                cands[int(g["id"])] = g
    ok, failed = [], []
    for gid, g in sorted(cands.items()):
        try:
            r = ingest_game(engine, gid, int(g["season"]), use_cache=False)
            ok.append(r)
        except Exception as e:  # noqa: BLE001
            failed.append((gid, str(e)))
            mark_error(engine, gid, g, str(e))
    if ok:
        rebuild_coaches(engine)
    return {"ingested": ok, "failed": failed}


# ----------------------------------------------------------------------------- coaches
def rebuild_coaches(engine: Engine, league: str = "NHL") -> int:
    """Tenures from the head coach named on each game: consecutive games per team, same coach."""
    with engine.begin() as c:
        rows = c.execute(text("""
            SELECT team, coach, game_date FROM (
                SELECT home_abbr AS team, home_coach AS coach, game_date FROM nhl_games WHERE home_coach IS NOT NULL AND error IS NULL
                UNION ALL
                SELECT away_abbr, away_coach, game_date FROM nhl_games WHERE away_coach IS NOT NULL AND error IS NULL
            ) x ORDER BY team, game_date
        """)).all()
        latest = {}
        for team, _, d in rows:
            latest[team] = max(latest.get(team, d), d)
        tenures = []
        for team, coach, d in rows:
            if tenures and tenures[-1]["team"] == team and tenures[-1]["coach"] == coach:
                tenures[-1]["end"] = d; tenures[-1]["games"] += 1
            else:
                tenures.append({"team": team, "coach": coach, "start": d, "end": d, "games": 1})
        c.execute(text("DELETE FROM coaches WHERE league = :l AND source = 'nhl_games'"), {"l": league})
        if tenures:
            c.execute(text("""
                INSERT INTO coaches (league, team, coach, role, start_date, end_date, games, source, updated_at)
                VALUES (:l, :team, :coach, 'head', :start, :end, :games, 'nhl_games', now())
                ON CONFLICT (league, team, coach, start_date) DO UPDATE SET end_date = EXCLUDED.end_date, games = EXCLUDED.games, updated_at = now()
            """), [dict(t, l=league, end=None if t["end"] == latest[t["team"]] and t["end"] >= date.today() - timedelta(days=60) else t["end"]) for t in tenures])
    return len(tenures)


# ----------------------------------------------------------------------------- CLI
if __name__ == "__main__":
    from .db import hockey_engine, run_migrations

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run_migrations()
    eng = hockey_engine()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "recent"
    if cmd == "backfill":
        seasons = [int(s) for s in sys.argv[2:] if s.isdigit()] or [20232024, 20242025, 20252026, 20262027]
        print(backfill(eng, seasons, refetch="--refetch" in sys.argv))
    elif cmd == "game":
        r = ingest_game(eng, int(sys.argv[2]), use_cache="--refetch" not in sys.argv)
        print(json.dumps(r, indent=1, default=str))
    elif cmd == "rederive":
        # Re-run parsing + derivation from the cached raw files (no network); after a rule change.
        with eng.connect() as c:
            ids = [(int(r[0]), int(r[1])) for r in c.execute(text("SELECT id, season FROM nhl_games WHERE error IS NULL ORDER BY id"))]
        n_ok = 0
        for gid, season in ids:
            try:
                ingest_game(eng, gid, season, use_cache=True); n_ok += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("rederive %s failed: %s", gid, e)
        rebuild_coaches(eng)
        print({"games": len(ids), "ok": n_ok})
    elif cmd == "coaches":
        print("tenures:", rebuild_coaches(eng))
    else:
        print(json.dumps(ingest_recent(eng), indent=1, default=str))


# ----------------------------------------------------------------------------- analysis
def situations(engine: Engine, seasons: Optional[List[int]] = None) -> dict:
    """Per team-game rows for the coach table plus every goalie episode.

    ``late_deficits`` is the set of deficits the team faced inside the last
    three minutes of regulation (score at 17:00 of P3, then after each later
    goal), so "down 1 late" means the team was down exactly one at some point
    with the clock under 3:00, whether or not it pulled.
    """
    where = "g.error IS NULL AND g.game_type IN (2, 3)" + (" AND g.season = ANY(:s)" if seasons else "")
    params = {"s": seasons} if seasons else {}
    with engine.connect() as c:
        games = c.execute(text(f"""
            SELECT g.id, g.season, g.game_type, g.game_date, g.home_abbr, g.away_abbr, g.home_coach, g.away_coach,
                   g.home_score, g.away_score, g.reg_home, g.reg_away, g.went_ot, g.went_so, g.pull_source,
                   l.away_score AS a1700, l.home_score AS h1700
            FROM nhl_games g
            LEFT JOIN LATERAL (
                SELECT away_score, home_score FROM nhl_plays p
                WHERE p.game_id = g.id AND (p.period < 3 OR (p.period = 3 AND p.elapsed_s <= 1020))
                ORDER BY p.period DESC, p.elapsed_s DESC, p.sort_order DESC LIMIT 1) l ON true
            WHERE {where} ORDER BY g.game_date, g.id
        """), params).mappings().all()
        late_goals = c.execute(text(f"""
            SELECT p.game_id, p.elapsed_s, p.away_score, p.home_score FROM nhl_plays p JOIN nhl_games g ON g.id = p.game_id
            WHERE {where} AND p.type = 'goal' AND p.period = 3 AND p.elapsed_s > 1020 ORDER BY p.game_id, p.sort_order
        """), params).mappings().all()
        episodes = [dict(r) for r in c.execute(text(f"""
            SELECT e.* FROM goalie_pulls e JOIN nhl_games g ON g.id = e.game_id WHERE {where} ORDER BY e.game_date, e.game_id, e.team_abbr, e.episode_no
        """), params).mappings().all()]
    goals_by_game: Dict[int, list] = {}
    for r in late_goals:
        goals_by_game.setdefault(int(r["game_id"]), []).append(r)
    eps_by_tg: Dict[Tuple[int, str], list] = {}
    for e in episodes:
        eps_by_tg.setdefault((int(e["game_id"]), e["team_abbr"]), []).append(e)
    rows = []
    for g in games:
        for is_home in (True, False):
            team = g["home_abbr"] if is_home else g["away_abbr"]
            def deficit(a, h):
                return (a - h) if is_home else (h - a)
            late = []
            if g["a1700"] is not None:
                late.append(deficit(g["a1700"], g["h1700"]))
            for lg in goals_by_game.get(int(g["id"]), []):
                late.append(deficit(lg["away_score"], lg["home_score"]))
            eps = eps_by_tg.get((int(g["id"]), team), [])
            pulls = [e for e in eps if e["kind"] == "pull"]
            rows.append({
                "game_id": int(g["id"]), "season": g["season"], "game_type": g["game_type"], "game_date": g["game_date"].isoformat(),
                "team": team, "is_home": is_home, "coach": g["home_coach"] if is_home else g["away_coach"],
                "opp": g["away_abbr"] if is_home else g["home_abbr"], "opp_coach": g["away_coach"] if is_home else g["home_coach"],
                "late_deficits": sorted(set(late)), "max_late_deficit": max(late) if late else None,
                "final_for": g["home_score"] if is_home else g["away_score"], "final_against": g["away_score"] if is_home else g["home_score"],
                "reg_for": g["reg_home"] if is_home else g["reg_away"], "reg_against": g["reg_away"] if is_home else g["reg_home"],
                "went_ot": g["went_ot"], "went_so": g["went_so"], "source": g["pull_source"],
                "pulls": [{"deficit": e["deficit"], "remaining_s": e["pull_remaining_s"], "duration_s": e["duration_s"], "goals_for": e["goals_for"],
                           "goals_against": e["goals_against"], "ended_by": e["ended_by"], "period": e["period"]} for e in pulls],
            })
    for e in episodes:
        e["game_date"] = e["game_date"].isoformat()
    seasons_seen = sorted({int(g["season"]) for g in games}, reverse=True)
    return {"situations": rows, "episodes": episodes, "seasons": seasons_seen}
