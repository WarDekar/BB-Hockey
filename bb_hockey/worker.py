"""The pricing and settlement passes. Run inside the API process (asyncio) or standalone."""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.engine import Engine

from . import odds_reader, pbp
from .config import settings
from .edges import evaluate_quotes, positive_edges
from .teams import nhl_abbr, resolve
from .model.goals import ModelParams
from .paper import auto_paper
from .pricer import load_params, price_game, upsert_game
from .settlement import settle_pass

logger = logging.getLogger(__name__)


def heartbeat(hockey: Engine, job: str, ok: bool, note: str = "") -> None:
    with hockey.begin() as c:
        c.execute(text("""
            INSERT INTO worker_heartbeat (job, last_run_at, ok, note) VALUES (:j, now(), :ok, :n)
            ON CONFLICT (job) DO UPDATE SET last_run_at = now(), ok = EXCLUDED.ok, note = EXCLUDED.note
        """), {"j": job, "ok": ok, "n": note[:500]})


def _status(g: dict) -> str:
    return "final" if g.get("completed") else ("live" if g.get("started") else "pregame")


def pricing_pass(odds: Engine, hockey: Engine, params: Optional[ModelParams] = None) -> dict:
    params = params or load_params(hockey)
    games = odds_reader.slate(odds)
    with hockey.begin() as c:
        for g in games:
            upsert_game(c, g)
    ids = [g["id"] for g in games]
    cons = odds_reader.consensus(odds, ids)
    quotes_by_game: Dict[int, List[dict]] = defaultdict(list)
    for q in odds_reader.book_quotes(odds, ids):
        quotes_by_game[int(q["game_id"])].append(q)
    priced, n_edges, placed, fresh = 0, 0, [], 0
    top: List[dict] = []
    for g in games:
        g = dict(g); g["status"] = _status(g)
        if g["status"] != "pregame" or g["id"] not in cons:
            continue
        home_t, away_t = resolve(g["home_name"]), resolve(g["away_name"])   # slate rows carry names, not abbreviations
        eng = pbp.eng_for_game(hockey, nhl_abbr(home_t.abbr if home_t else None), nhl_abbr(away_t.abbr if away_t else None), params)
        with hockey.begin() as c:
            r = price_game(c, g, cons[g["id"]], params, eng)
            if r is None:
                continue
            sid, model, inputs, is_fresh, base = r
            priced += 1; fresh += int(is_fresh)
            rows = evaluate_quotes(model, quotes_by_game.get(g["id"], []), base)
            pos = positive_edges(rows, min_ev=0.0)
            c.execute(text("DELETE FROM edges WHERE game_id = :g"), {"g": g["id"]})
            if pos:
                c.execute(text("""
                    INSERT INTO edges (snapshot_id, game_id, market, side, point, period_src, sportsbook_id, sportsbook,
                                       book_group, price, quoted_at, fair_prob, push_prob, fair_price, ev, kelly, base_prob, base_ev)
                    VALUES (:sid, :game_id, :market, :side, :point, :period_src, :sportsbook_id, :sportsbook,
                            :book_group, :price, :quoted_at, :fair_prob, :push_prob, :fair_price, :ev, :kelly, :base_prob, :base_ev)
                """), [dict(r, sid=sid) for r in pos])
            n_edges += sum(1 for r in pos if r["ev"] >= settings.min_edge)
            top.extend(dict(r, home=g["home_name"], away=g["away_name"]) for r in pos[:3] if r["ev"] >= settings.min_edge)
            placed.extend(auto_paper(c, g, rows, sid))
    note = f"{len(games)} games, {priced} priced ({fresh} new snapshots), {n_edges} edges ≥ {settings.min_edge:.0%}, {len(placed)} auto bets"
    heartbeat(hockey, "pricing", True, note)
    logger.info("pricing pass: %s", note)
    return {"games": len(games), "priced": priced, "new_snapshots": fresh, "edges": n_edges, "placed": placed,
            "top": sorted(top, key=lambda r: -r["ev"])[:10], "at": datetime.now(timezone.utc).isoformat()}


def settlement_pass(odds: Engine, hockey: Engine, params: Optional[ModelParams] = None) -> dict:
    params = params or load_params(hockey)
    out = settle_pass(odds, hockey, params)
    note = f"{len(out['settled'])} settled, {out['pending']} awaiting a final, {out['marked_live']} marked live"
    heartbeat(hockey, "settlement", True, note)
    logger.info("settlement pass: %s", note)
    return out


def pbp_pass(odds: Engine, hockey: Engine, params: Optional[ModelParams] = None) -> dict:
    """Ingest NHL.com play-by-play / shift charts for any final of the last two days."""
    from . import pbp
    out = pbp.ingest_recent(hockey)
    note = f"{len(out['ingested'])} ingested, {len(out['failed'])} failed"
    if out["ingested"]:
        note += ": " + ", ".join(f"{r['score']} ({len(r['pulls'])} pulls)" for r in out["ingested"][:6])
    heartbeat(hockey, "pbp", not out["failed"] or bool(out["ingested"]), note)
    logger.info("pbp pass: %s", note)
    return {"ingested": [r["id"] for r in out["ingested"]], "failed": out["failed"], "top": []}


async def run_forever(odds: Engine, hockey: Engine, on_update: Optional[Callable[[dict], "object"]] = None) -> None:
    """asyncio driver: pricing every ``price_interval``, settlement every ``settle_interval``."""
    import asyncio

    async def loop(job: str, fn, interval: int):
        while True:
            try:
                result = await asyncio.to_thread(fn, odds, hockey)
                if on_update:
                    await on_update({"job": job, **{k: v for k, v in result.items() if k != "top"}, "top": result.get("top", [])})
            except Exception as e:  # noqa: BLE001
                logger.exception("%s pass failed: %s", job, e)
                try:
                    await asyncio.to_thread(heartbeat, hockey, job, False, str(e))
                except Exception:  # noqa: BLE001
                    pass
            await asyncio.sleep(interval)

    await asyncio.gather(loop("pricing", pricing_pass, settings.price_interval),
                         loop("settlement", settlement_pass, settings.settle_interval),
                         loop("pbp", pbp_pass, settings.pbp_interval))


if __name__ == "__main__":
    import asyncio

    from .db import hockey_engine, odds_engine, run_migrations

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run_migrations()
    asyncio.run(run_forever(odds_engine(), hockey_engine()))
