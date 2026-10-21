"""JSON API. Mounted under /hockey/api (gateway) and /api (direct alias)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from .. import __version__, calibration, odds_reader, paper, pbp
from ..config import settings
from ..db import hockey_engine, odds_engine
from ..edges import best_per_side, evaluate_quotes
from ..model.goals import MARKETS, ModelParams
from ..model.odds_math import ev_per_unit, fair_price_no_push, kelly_fraction
from ..pricer import baseline_from_snapshot, latest_snapshot, load_params, model_from_snapshot, save_params
from ..teams import nhl_abbr
from ..worker import pbp_pass, pricing_pass, settlement_pass

router = APIRouter()


def _rows(sql: str, **params) -> List[dict]:
    with hockey_engine().connect() as c:
        return [dict(r) for r in c.execute(text(sql), params).mappings().all()]


@router.get("/health")
def health() -> dict:
    hb = {r["job"]: r for r in _rows("SELECT job, last_run_at, ok, note FROM worker_heartbeat")}
    counts = _rows("""SELECT (SELECT count(*) FROM games) AS games, (SELECT count(*) FROM games WHERE status='final') AS finals,
                             (SELECT count(*) FROM paper_bets WHERE status='pending') AS pending_bets,
                             (SELECT count(*) FROM pricing_snapshots) AS snapshots""")[0]
    status = "ok"
    for job, within in (("pricing", settings.price_interval * 5), ("settlement", settings.settle_interval * 3)):
        h = hb.get(job)
        if not h or not h["ok"] or (datetime.now(timezone.utc) - h["last_run_at"]).total_seconds() > within:
            status = "degraded"
    return {"status": status, "version": __version__, "heartbeats": hb, "counts": counts,
            "paper": {"auto": settings.auto_paper, "min_edge": settings.min_edge, "kelly_fraction": settings.kelly_fraction}}


@router.get("/slate")
def slate(hours_back: int = 14, hours_ahead: Optional[int] = None) -> List[dict]:
    hours_ahead = hours_ahead or settings.slate_hours_ahead
    now = datetime.now(timezone.utc)
    games = _rows("""
        SELECT g.*, s.id AS snapshot_id, s.computed_at AS priced_at, s.inputs, s.summary,
               (SELECT count(*) FROM edges e WHERE e.game_id = g.id AND e.ev >= :min_edge) AS n_edges,
               (SELECT max(ev) FROM edges e WHERE e.game_id = g.id) AS best_ev,
               (SELECT count(*) FROM paper_bets b WHERE b.game_id = g.id AND b.status <> 'void') AS n_bets,
               (SELECT COALESCE(sum(pnl), 0) FROM paper_bets b WHERE b.game_id = g.id) AS pnl
        FROM games g
        LEFT JOIN LATERAL (SELECT id, computed_at, inputs, summary FROM pricing_snapshots p
                           WHERE p.game_id = g.id AND p.kind = 'live' ORDER BY computed_at DESC LIMIT 1) s ON true
        WHERE g.game_time BETWEEN :lo AND :hi ORDER BY g.game_time, g.id
    """, lo=now - timedelta(hours=hours_back), hi=now + timedelta(hours=hours_ahead), min_edge=settings.min_edge)
    notes = pbp.notes_by_team(hockey_engine())
    for g in games:
        g["home_bench"] = notes.get(nhl_abbr(g.get("home_abbr")))
        g["away_bench"] = notes.get(nhl_abbr(g.get("away_abbr")))
    return games


class ManualBet(BaseModel):
    game_id: int
    market: str
    side: str
    point: Optional[float] = None
    sportsbook: str = "manual"
    sportsbook_id: Optional[int] = None
    price: float
    stake: float = Field(gt=0)
    note: Optional[str] = None


@router.get("/games/{game_id}")
def game_detail(game_id: int) -> dict:
    rows = _rows("SELECT * FROM games WHERE id = :g", g=game_id)
    if not rows:
        raise HTTPException(404, "unknown game")
    game = rows[0]
    with hockey_engine().connect() as c:
        snap = latest_snapshot(c, game_id, kind="live")
        closing = latest_snapshot(c, game_id, kind="closing")
    quotes_eval, best = [], {}
    if snap and game["status"] != "final":
        model = model_from_snapshot(snap)
        try:
            quotes = odds_reader.book_quotes(odds_engine(), [game_id])
        except Exception:  # noqa: BLE001
            quotes = []
        quotes_eval = evaluate_quotes(model, quotes, baseline_from_snapshot(snap))
        best = {f"{k[0]}|{k[1]}|{k[2]}": v for k, v in best_per_side(quotes_eval).items()}
    edges = _rows("SELECT * FROM edges WHERE game_id = :g AND ev >= 0 ORDER BY ev DESC", g=game_id)
    bets = _rows("SELECT * FROM paper_bets WHERE game_id = :g ORDER BY placed_at DESC", g=game_id)
    if closing:
        closing = {k: v for k, v in closing.items() if k != "board"} | {"board": closing["board"]}
    return {"game": game, "snapshot": snap, "closing": closing, "quotes": quotes_eval, "best": best,
            "edges": edges, "bets": bets, "markets": list(MARKETS)}


@router.get("/edges")
def edges(min_ev: Optional[float] = None, limit: int = 5000) -> List[dict]:
    min_ev = settings.min_edge if min_ev is None else min_ev
    return _rows("""
        SELECT e.*, g.home_name, g.away_name, g.home_abbr, g.away_abbr, g.game_time, g.status,
               EXISTS (SELECT 1 FROM paper_bets b WHERE b.game_id = e.game_id AND b.market = e.market AND b.side = e.side
                       AND b.point IS NOT DISTINCT FROM e.point AND b.status <> 'void') AS papered
        FROM edges e JOIN games g ON g.id = e.game_id
        WHERE e.ev >= :min_ev AND g.status = 'pregame' AND g.game_time > now()
          AND e.computed_at > now() - interval '20 minutes'   -- only edges from a pass the current model made
        ORDER BY e.ev DESC LIMIT :lim
    """, min_ev=min_ev, lim=limit)


@router.get("/bets")
def bets(status: Optional[str] = None, limit: int = 500) -> List[dict]:
    return paper.ledger(hockey_engine(), status, limit)


@router.get("/bets/summary")
def bets_summary() -> dict:
    return paper.summary(hockey_engine())


@router.post("/bets", status_code=201)
def add_bet(body: ManualBet) -> dict:
    if body.market not in MARKETS:
        raise HTTPException(422, f"unknown market; one of {', '.join(MARKETS)}")
    with hockey_engine().connect() as c:
        game = c.execute(text("SELECT id, status, game_time FROM games WHERE id = :g"), {"g": body.game_id}).mappings().first()
        snap = latest_snapshot(c, body.game_id, kind="live")
    if not game:
        raise HTTPException(404, "unknown game")
    if game["status"] != "pregame":
        raise HTTPException(409, "game has started")
    if not snap:
        raise HTTPException(409, "no pricing snapshot for this game yet")
    r = model_from_snapshot(snap).prob_for(body.market, body.side, body.point)
    if r is None:
        raise HTTPException(422, "market/side/point not priceable")
    p_win, p_push = r
    ev = ev_per_unit(p_win, p_push, body.price)
    if ev is None:
        raise HTTPException(422, "bad price")
    bet_id = paper.place_manual(hockey_engine(), body.game_id, body.market, body.side, body.point, body.sportsbook,
                                body.price, body.stake, round(p_win, 5), round(p_push, 5), round(ev, 5),
                                kelly_fraction(p_win, p_push, body.price), snap["id"], body.note, body.sportsbook_id)
    return {"id": bet_id, "fair_prob": round(p_win, 5), "push_prob": round(p_push, 5), "ev": round(ev, 5),
            "fair_price": fair_price_no_push(p_win, p_push)}


@router.post("/bets/{bet_id}/void")
def void(bet_id: int) -> dict:
    if not paper.void_bet(hockey_engine(), bet_id):
        raise HTTPException(409, "bet is not pending")
    return {"ok": True}


@router.get("/results")
def results(days: int = 14) -> List[dict]:
    return _rows("""
        SELECT g.*, s.summary AS closing_summary, s.inputs AS closing_inputs,
               (SELECT count(*) FROM paper_bets b WHERE b.game_id = g.id AND b.status <> 'void') AS n_bets,
               (SELECT COALESCE(sum(pnl), 0) FROM paper_bets b WHERE b.game_id = g.id) AS pnl
        FROM games g
        LEFT JOIN LATERAL (SELECT summary, inputs FROM pricing_snapshots p WHERE p.game_id = g.id AND p.kind = 'closing'
                           ORDER BY computed_at DESC LIMIT 1) s ON true
        WHERE g.status = 'final' AND g.game_time >= now() - make_interval(days => :d) ORDER BY g.game_time DESC
    """, d=days)


@router.get("/calibration")
def calib(family: Optional[str] = None) -> dict:
    e = hockey_engine()
    return {"buckets": calibration.buckets(e, family), "by_family": calibration.by_family(e),
            "diagnostics": calibration.diagnostics(e), "families": sorted(set(calibration.FAMILIES.values()))}


class ParamsBody(BaseModel):
    max_goals: Optional[int] = None
    draw_inflation: Optional[float] = None
    eng_rate: Optional[float] = None
    eng_rate2: Optional[float] = None
    eng_chain: Optional[float] = None
    eng_rate3: Optional[float] = None
    eng_prior_games: Optional[int] = None
    strength_sigma: Optional[float] = None
    coach_eng: Optional[bool] = None
    late_kernel: Optional[bool] = None
    kernel_pace_k: Optional[float] = None
    kernel_pace_ref: Optional[float] = None
    ot_decided_share: Optional[float] = None
    ot_skill_k: Optional[float] = None
    so_skill_k: Optional[float] = None
    period_shares: Optional[List[float]] = None
    period_draw_inflation: Optional[float] = None
    default_total: Optional[float] = None


@router.get("/params")
def get_params() -> dict:
    return {"params": load_params(hockey_engine()).to_dict(), "defaults": ModelParams().to_dict()}


@router.put("/params")
def put_params(body: ParamsBody) -> dict:
    cur = load_params(hockey_engine()).to_dict()
    cur.update({k: v for k, v in body.model_dump().items() if v is not None})
    p = ModelParams.from_dict(cur)
    if abs(sum(p.period_shares) - 1.0) > 1e-6 or len(p.period_shares) != 3:
        raise HTTPException(422, "period_shares must be three numbers summing to 1")
    save_params(hockey_engine(), p)
    return {"params": p.to_dict()}


@router.post("/run/pricing")
def run_pricing() -> dict:
    return pricing_pass(odds_engine(), hockey_engine())


@router.post("/run/settlement")
def run_settlement() -> dict:
    return settlement_pass(odds_engine(), hockey_engine())


@router.get("/pulls")
def pulls(deficit: int = 1, season: Optional[str] = None, game_type: Optional[int] = None, venue: Optional[str] = None,
          teams: Optional[str] = None, coaches: Optional[str] = None, min_n: int = 1, bin_s: int = 30) -> dict:
    """Goalie-pull desk, aggregated in SQL over the materialized situations view (no raw play-by-play leaves the server)."""
    split = lambda v: [x for x in v.split(",") if x] if v else None  # noqa: E731
    out = pbp.pull_report(hockey_engine(), deficit, seasons=split(season), game_type=game_type, venue=venue,
                          teams=split(teams), coaches=split(coaches), min_n=min_n, bin_s=bin_s)
    out["coaches"] = _rows("SELECT league, team, coach, start_date, end_date, games FROM coaches ORDER BY team, start_date")
    return out


@router.get("/pulls/notes")
def pull_notes() -> dict:
    """Cliff notes per current head coach: puck-line and alt-puck-line leans from late-deficit outcomes."""
    return pbp.coach_notes(hockey_engine())


@router.post("/run/pbp")
def run_pbp() -> dict:
    return pbp_pass(odds_engine(), hockey_engine())
