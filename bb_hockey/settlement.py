"""Results from ESPN, bet grading, closing-line value, calibration observations."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from . import espn, odds_reader
from .edges import market_key
from .model.goals import GameModel, ModelParams
from .model.odds_math import american_to_decimal
from .paper import pnl_for
from .pricer import build_inputs, fit_from_inputs, latest_snapshot, model_from_snapshot, write_snapshot

logger = logging.getLogger(__name__)
GAME_LENGTH = timedelta(hours=2, minutes=40)


def grade(market: str, side: str, point: Optional[float], res: dict) -> Optional[str]:
    """'won' | 'lost' | 'push' for a settled result, None if the result lacks the data."""
    fh, fa = res.get("final_home"), res.get("final_away")
    rh, ra = res.get("reg_home"), res.get("reg_away")
    periods = res.get("periods") or []

    def two_way(diff: float, pt: Optional[float]) -> str:
        v = diff + (pt or 0.0)
        return "won" if v > 0 else "push" if v == 0 else "lost"

    def over_under(total: float, pt: float) -> str:
        if side == "over":
            return "won" if total > pt else "push" if total == pt else "lost"
        return "won" if total < pt else "push" if total == pt else "lost"

    if market == "ml":
        if fh is None or fa is None:
            return None
        return "won" if (fh > fa) == (side == "home") else "lost"
    if market == "3way":
        if rh is None or ra is None:
            return None
        outcome = "home" if rh > ra else "away" if ra > rh else "draw"
        return "won" if outcome == side else "lost"
    if market == "puck":
        if fh is None or fa is None or point is None:
            return None
        return two_way((fh - fa) if side == "home" else (fa - fh), point)
    if market == "total":
        if fh is None or fa is None or point is None:
            return None
        return over_under(fh + fa, point)
    if market == "reg_total":
        if rh is None or ra is None or point is None:
            return None
        return over_under(rh + ra, point)
    if market in ("team_total_home", "team_total_away"):
        goals = fh if market.endswith("home") else fa
        if goals is None or point is None:
            return None
        return over_under(goals, point)
    if market[:1] == "p" and market[1:2].isdigit():
        k = int(market[1]) - 1
        if k >= len(periods) or periods[k] is None:
            return None
        h, a = periods[k]
        if h is None or a is None:
            return None
        kind = market[3:]
        if kind == "ml":
            if h == a:
                return "push"
            return "won" if (h > a) == (side == "home") else "lost"
        if kind == "3way":
            outcome = "home" if h > a else "away" if a > h else "draw"
            return "won" if outcome == side else "lost"
        if kind == "spread":
            if point is None:
                return None
            return two_way((h - a) if side == "home" else (a - h), point)
        if kind == "total":
            if point is None:
                return None
            return over_under(h + a, point)
    return None


def fetch_result(game: dict) -> Optional[dict]:
    """ESPN result for a game row from our ``games`` table (None if not found or not final)."""
    res = None
    if game.get("espn_game_id"):
        try:
            res = espn.summary(int(game["espn_game_id"]))
        except Exception as e:  # noqa: BLE001
            logger.warning("espn summary %s failed: %s", game["espn_game_id"], e)
    if res is None:
        res = espn.find_event(game["game_time"], game["home_name"], game["away_name"])
    return res


def closing_model(odds: Engine, c: Connection, game: dict, params: ModelParams) -> Tuple[Optional[GameModel], Optional[dict], str]:
    """Model refit on the consensus close; falls back to our last pregame snapshot."""
    existing = latest_snapshot(c, game["id"], kind="closing")
    if existing:
        return model_from_snapshot(existing), existing, "closing_snapshot"
    cons = odds_reader.closing_consensus(odds, game["id"], game["game_time"])
    inputs = build_inputs(cons, params) if cons else None
    if inputs:
        model, summary = fit_from_inputs(inputs, params)
        inputs["source"] = "main.odds consensus close"
        sid = write_snapshot(c, game["id"], "closing", inputs, params, summary, model.board())
        snap = latest_snapshot(c, game["id"], kind="closing")
        return model, snap, "main.odds"
    last = c.execute(text("""
        SELECT id, game_id, computed_at, kind, inputs, params, summary, board FROM pricing_snapshots
        WHERE game_id = :g AND kind = 'live' AND computed_at <= :t ORDER BY computed_at DESC LIMIT 1
    """), {"g": game["id"], "t": game["game_time"] + timedelta(minutes=45)}).mappings().first()
    if last:
        last = dict(last)
        inputs = dict(last["inputs"]); inputs["source"] = "last live snapshot (no main.odds close)"
        write_snapshot(c, game["id"], "closing", inputs, ModelParams.from_dict(last["params"]), last["summary"], last["board"])
        return model_from_snapshot(last), latest_snapshot(c, game["id"], kind="closing"), "last_snapshot"
    return None, None, "none"


_SRC_FOR_MARKET = {"ml": ("h2h", "game"), "puck": ("spreads", "game"), "total": ("totals", "game"),
                   "p1_ml": ("h2h", "1q"), "p1_spread": ("spreads", "1q"), "p1_total": ("totals", "1q"),
                   "p2_ml": ("h2h", "2h"), "p2_spread": ("spreads", "2h"), "p2_total": ("totals", "2h")}


def clv_for_bet(odds: Engine, bet: dict, game: dict, cm: Optional[GameModel]) -> dict:
    out = {"closing_fair_prob": None, "clv_model": None, "closing_price": None, "clv_price": None}
    if cm is not None:
        r = cm.prob_for(bet["market"], bet["side"], bet["point"])
        if r:
            out["closing_fair_prob"] = round(r[0], 5)
            out["clv_model"] = round(r[0] - bet["fair_prob"], 5)
    src = _SRC_FOR_MARKET.get(bet["market"])
    if src and bet.get("sportsbook_id"):
        mt, period = src
        home_point = None
        if mt != "h2h":
            home_point = bet["point"] if bet["side"] in ("home", "over") else -bet["point"]
        try:
            q = odds_reader.closing_book_quote(odds, game["id"], mt, period, bet["sportsbook_id"], game["game_time"], home_point)
        except Exception as e:  # noqa: BLE001
            logger.warning("closing quote lookup failed: %s", e)
            q = None
        if q:
            price = q["home_price"] if bet["side"] in ("home", "over") else q["away_price"]
            if price is not None:
                out["closing_price"] = float(price)
                d_bet, d_close = american_to_decimal(bet["price"]), american_to_decimal(price)
                if d_bet and d_close:
                    out["clv_price"] = round(d_bet / d_close - 1.0, 5)
    return out


def settle_game(odds: Engine, c: Connection, game: dict, res: dict, params: ModelParams) -> dict:
    result = {
        "final_home": res["home_score"], "final_away": res["away_score"],
        "reg_home": res["reg_home"], "reg_away": res["reg_away"],
        "periods": res["periods"], "went_ot": res["went_ot"], "went_so": res["went_so"],
    }
    c.execute(text("""
        UPDATE games SET status='final', final_home=:fh, final_away=:fa, reg_home=:rh, reg_away=:ra,
               periods=CAST(:p AS jsonb), went_ot=:ot, went_so=:so, espn_game_id=COALESCE(:espn, espn_game_id),
               result_source='espn', settled_at=now(), updated_at=now() WHERE id=:id
    """), {"fh": result["final_home"], "fa": result["final_away"], "rh": result["reg_home"], "ra": result["reg_away"],
           "p": json.dumps(result["periods"]), "ot": result["went_ot"], "so": result["went_so"],
           "espn": res.get("espn_game_id"), "id": game["id"]})
    cm, snap, src = closing_model(odds, c, game, params)
    bets = [dict(r) for r in c.execute(text("SELECT * FROM paper_bets WHERE game_id=:g AND status='pending'"), {"g": game["id"]}).mappings()]
    graded = 0
    for b in bets:
        status = grade(b["market"], b["side"], b["point"], result)
        if status is None:
            continue
        clv = clv_for_bet(odds, b, game, cm)
        c.execute(text("""
            UPDATE paper_bets SET status=:st, pnl=:pnl, settled_at=now(), closing_fair_prob=:cfp, closing_price=:cp,
                   clv_model=:cm, clv_price=:cpv WHERE id=:id
        """), {"st": status, "pnl": pnl_for(status, b["stake"], b["price"]), "cfp": clv["closing_fair_prob"],
               "cp": clv["closing_price"], "cm": clv["clv_model"], "cpv": clv["clv_price"], "id": b["id"]})
        graded += 1
    obs = 0
    if snap:
        for row in snap["board"]:
            st = grade(row["market"], row["side"], row["point"], result)
            if st is None:
                continue
            c.execute(text("""
                INSERT INTO calibration_obs (game_id, market, side, point, prob, outcome, kind)
                VALUES (:g, :m, :s, :pt, :p, :o, 'closing') ON CONFLICT DO NOTHING
            """), {"g": game["id"], "m": row["market"], "s": row["side"], "pt": row["point"], "p": row["prob"],
                   "o": None if st == "push" else (1 if st == "won" else 0)})
            obs += 1
    return {"game_id": game["id"], "bets_graded": graded, "calibration_obs": obs, "closing_source": src,
            "score": f"{res['away_score']}-{res['home_score']}", "ot": res["went_ot"], "so": res["went_so"]}


def settle_pass(odds: Engine, hockey: Engine, params: ModelParams) -> dict:
    now = datetime.now(timezone.utc)
    with hockey.connect() as c:
        due = [dict(r) for r in c.execute(text("""
            SELECT id, espn_game_id, game_time, home_name, away_name, status FROM games
            WHERE settled_at IS NULL AND game_time <= :t ORDER BY game_time
        """), {"t": now - GAME_LENGTH}).mappings()]
        live = c.execute(text("UPDATE games SET status='live', updated_at=now() WHERE status='pregame' AND game_time <= :t"),
                         {"t": now}).rowcount
        c.commit()
    settled, pending = [], 0
    for g in due:
        try:
            res = fetch_result(g)
        except Exception as e:  # noqa: BLE001
            logger.warning("result fetch failed for %s: %s", g["id"], e)
            res = None
        if not res or not res.get("completed") or res.get("home_score") is None:
            pending += 1
            continue
        with hockey.begin() as c:
            settled.append(settle_game(odds, c, g, res, params))
    return {"settled": settled, "pending": pending, "marked_live": live}
