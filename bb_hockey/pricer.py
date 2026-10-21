"""Consensus → model inputs → fitted GameModel → pricing snapshot.

A snapshot is written when the inputs move (or every ``SNAPSHOT_MIN_GAP``
even if they do not), so the history is a record of the market, not of
the clock. The last snapshot before the start doubles as the closing one
if ``main.odds`` has no close for the game.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from .config import settings
from .model.goals import GameModel, ModelParams, fit_lambdas
from .model.odds_math import devig_two_way
from .teams import resolve

logger = logging.getLogger(__name__)
SNAPSHOT_MIN_GAP = timedelta(minutes=15)
INPUT_TOL = 2e-4


def load_params(engine: Engine) -> ModelParams:
    with engine.connect() as c:
        row = c.execute(text("SELECT value FROM settings WHERE key='model_params'")).first()
    return ModelParams.from_dict(row[0] if row else None)


def save_params(engine: Engine, params: ModelParams) -> None:
    with engine.begin() as c:
        c.execute(text("""
            INSERT INTO settings(key, value, updated_at) VALUES ('model_params', CAST(:v AS jsonb), now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        """), {"v": json.dumps(params.to_dict())})


def build_inputs(cons: Dict[tuple, dict], params: ModelParams, method: Optional[str] = None, eng: Optional[dict] = None) -> Optional[dict]:
    """Fair ML + fair total from the consensus rows, plus the market's own P1 fairs as diagnostics."""
    method = method or settings.devig_method
    h2h = cons.get(("h2h", "game"))
    if not h2h or h2h.get("home_price") is None or h2h.get("away_price") is None:
        return None
    p_home, _ = devig_two_way(h2h["home_price"], h2h["away_price"], method)
    tot = cons.get(("totals", "game"))
    stamps = [h2h.get("timestamp")]
    if tot and tot.get("home_point") is not None and tot.get("home_price") is not None:
        p_over, _ = devig_two_way(tot["home_price"], tot["away_price"], method)
        total_point, assumed = float(tot["home_point"]), False
        stamps.append(tot.get("timestamp"))
    else:
        p_over, total_point, assumed = 0.5, params.default_total, True
    out = {
        "p_home": round(p_home, 6), "total_point": total_point, "p_over": round(p_over, 6),
        "total_assumed": assumed, "devig": method,
        "consensus_at": max(s for s in stamps if s).isoformat() if any(stamps) else None,
        "market": {},
        "eng": eng,   # per-game empty-net rates from the benches (pbp.eng_for_game), None → ModelParams defaults
    }
    sp = cons.get(("spreads", "game"))
    if sp and sp.get("home_price") is not None:
        p, _ = devig_two_way(sp["home_price"], sp["away_price"], method)
        out["market"]["puck_home"] = {"point": sp.get("home_point"), "prob": round(p, 5)}
    for mt, key in (("h2h", "p1_ml_home"), ("spreads", "p1_spread_home"), ("totals", "p1_total_over")):
        row = cons.get((mt, "1q")) or cons.get((mt, "1h"))
        if row and row.get("home_price") is not None and row.get("away_price") is not None:
            p, _ = devig_two_way(row["home_price"], row["away_price"], method)
            out["market"][key] = {"point": row.get("home_point"), "prob": round(p, 5)}
    return out


def fit_from_inputs(inputs: dict, params: ModelParams) -> Tuple[GameModel, dict]:
    eng = (inputs.get("eng") or {}).get("rates")
    lh, la, diag = fit_lambdas(inputs["p_home"], inputs["total_point"], inputs["p_over"], params, eng)
    model = GameModel(lh, la, params, eng)
    summary = model.summary()
    summary.update(diag)
    summary["market_check"] = market_check(model, inputs)
    return model, summary


def market_check(model: GameModel, inputs: dict) -> dict:
    """Model fair minus the market's own devigged fair on the derivative points BB-Odds
    carries a consensus for (puck −1.5, P1 ML / spread / total). Pushes conditioned out
    so the numbers compare like for like. A diagnostic, never an input."""
    out = {}
    mk = inputs.get("market") or {}

    def cond(r):
        return r[0] / (r[0] + max(0.0, 1 - r[0] - r[1])) if r and (r[0] + max(0.0, 1 - r[0] - r[1])) > 0 else None

    checks = {
        "puck_home": ("puck", "home"), "p1_ml_home": ("p1_ml", "home"),
        "p1_spread_home": ("p1_spread", "home"), "p1_total_over": ("p1_total", "over"),
    }
    for key, (market, side) in checks.items():
        m = mk.get(key)
        if not m or m.get("prob") is None:
            continue
        r = model.prob_for(market, side, m.get("point"))
        p = cond(r)
        if p is not None:
            out[key] = {"point": m.get("point"), "market": m["prob"], "model": round(p, 5), "diff": round(p - m["prob"], 5)}
    return out


def model_from_snapshot(snapshot: dict) -> GameModel:
    s = snapshot["summary"]
    eng = ((snapshot.get("inputs") or {}).get("eng") or {}).get("rates")
    return GameModel(s["lambda_home"], s["lambda_away"], ModelParams.from_dict(snapshot.get("params")), eng)


def upsert_game(c: Connection, g: dict) -> None:
    home, away = resolve(g["home_name"]), resolve(g["away_name"])
    # BB-Odds's completed flag only tells us the game is over; 'final' is set by
    # settlement once ESPN has graded it, otherwise settle_pass would never see it.
    status = "live" if (g.get("completed") or g.get("started")) else "pregame"
    c.execute(text("""
        INSERT INTO games (id, external_id, espn_game_id, game_time, home_name, away_name, home_abbr, away_abbr,
                           home_rotation, away_rotation, status, updated_at)
        VALUES (:id, :ext, :espn, :t, :hn, :an, :ha, :aa, :hr, :ar, :st, now())
        ON CONFLICT (id) DO UPDATE SET
            external_id = EXCLUDED.external_id,
            espn_game_id = COALESCE(EXCLUDED.espn_game_id, games.espn_game_id),
            game_time = EXCLUDED.game_time,
            home_name = EXCLUDED.home_name, away_name = EXCLUDED.away_name,
            home_abbr = EXCLUDED.home_abbr, away_abbr = EXCLUDED.away_abbr,
            home_rotation = EXCLUDED.home_rotation, away_rotation = EXCLUDED.away_rotation,
            status = CASE WHEN games.status = 'final' THEN games.status ELSE EXCLUDED.status END,
            updated_at = now()
    """), {"id": g["id"], "ext": g.get("external_id"), "espn": g.get("espn_game_id"), "t": g["game_time"],
           "hn": g["home_name"], "an": g["away_name"], "ha": home.abbr if home else None, "aa": away.abbr if away else None,
           "hr": g.get("home_rotation"), "ar": g.get("away_rotation"), "st": status})


def latest_snapshot(c: Connection, game_id: int, kind: Optional[str] = None) -> Optional[dict]:
    q = "SELECT id, game_id, computed_at, kind, inputs, params, summary, board FROM pricing_snapshots WHERE game_id = :g"
    if kind:
        q += " AND kind = :k"
    q += " ORDER BY computed_at DESC LIMIT 1"
    row = c.execute(text(q), {"g": game_id, "k": kind}).mappings().first()
    return dict(row) if row else None


def _inputs_moved(prev: Optional[dict], new: dict) -> bool:
    if not prev:
        return True
    pi = prev["inputs"]
    return (abs(pi.get("p_home", 0) - new["p_home"]) > INPUT_TOL
            or abs(pi.get("p_over", 0) - new["p_over"]) > INPUT_TOL
            or pi.get("total_point") != new["total_point"]
            or (pi.get("eng") or {}).get("rates") != (new.get("eng") or {}).get("rates"))


def write_snapshot(c: Connection, game_id: int, kind: str, inputs: dict, params: ModelParams,
                   summary: dict, board: list) -> int:
    row = c.execute(text("""
        INSERT INTO pricing_snapshots (game_id, kind, inputs, params, summary, board)
        VALUES (:g, :k, CAST(:i AS jsonb), CAST(:p AS jsonb), CAST(:s AS jsonb), CAST(:b AS jsonb)) RETURNING id
    """), {"g": game_id, "k": kind, "i": json.dumps(inputs, default=str), "p": json.dumps(params.to_dict()),
           "s": json.dumps(summary), "b": json.dumps(board)}).first()
    return int(row[0])


def price_game(c: Connection, game: dict, cons: Dict[tuple, dict], params: ModelParams, eng: Optional[dict] = None) -> Optional[Tuple[int, GameModel, dict, bool]]:
    """Fit and (maybe) snapshot one game. Returns (snapshot_id, model, inputs, fresh)."""
    inputs = build_inputs(cons, params, eng=eng)
    if inputs is None:
        return None
    prev = latest_snapshot(c, game["id"], kind="live")
    now = datetime.now(timezone.utc)
    if prev and not _inputs_moved(prev, inputs) and prev["params"] == params.to_dict() \
            and now - prev["computed_at"] < SNAPSHOT_MIN_GAP:
        return int(prev["id"]), model_from_snapshot(prev), prev["inputs"], False
    model, summary = fit_from_inputs(inputs, params)
    sid = write_snapshot(c, game["id"], "live", inputs, params, summary, model.board())
    return sid, model, inputs, True
