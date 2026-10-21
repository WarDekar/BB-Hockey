"""Reliability of the closing-model probabilities, plus the structural rates the priors assume."""
from __future__ import annotations

from typing import List

from sqlalchemy import text
from sqlalchemy.engine import Engine

FAMILIES = {
    "ml": "Moneyline", "3way": "60-min 3-way", "puck": "Puck lines", "total": "Game totals",
    "reg_total": "Regulation totals", "team_total_home": "Team totals", "team_total_away": "Team totals",
    "p1_ml": "P1 moneyline", "p1_3way": "P1 3-way", "p1_spread": "P1 spread", "p1_total": "P1 totals",
    "p2_ml": "P2 moneyline", "p2_3way": "P2 3-way", "p2_spread": "P2 spread", "p2_total": "P2 totals",
    "p3_ml": "P3 moneyline", "p3_3way": "P3 3-way", "p3_spread": "P3 spread", "p3_total": "P3 totals",
}


def buckets(engine: Engine, family: str | None = None, n_buckets: int = 10) -> List[dict]:
    q = """
        SELECT width_bucket(prob, 0, 1, :nb) AS b, count(*) AS n, avg(prob) AS mean_prob, avg(outcome) AS hit,
               avg((prob - outcome)^2) AS brier
        FROM calibration_obs WHERE outcome IS NOT NULL
    """
    params = {"nb": n_buckets}
    if family:
        q += " AND market = ANY(:m)"
        params["m"] = [k for k, v in FAMILIES.items() if v == family or k == family]
    q += " GROUP BY b ORDER BY b"
    with engine.connect() as c:
        return [dict(r) for r in c.execute(text(q), params).mappings()]


def by_family(engine: Engine) -> List[dict]:
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT market, count(*) AS n, avg(prob) AS mean_prob, avg(outcome) AS hit, avg((prob - outcome)^2) AS brier,
                   avg(outcome) - avg(prob) AS bias
            FROM calibration_obs WHERE outcome IS NOT NULL GROUP BY market ORDER BY market
        """)).mappings().all()
    out = {}
    for r in rows:
        fam = FAMILIES.get(r["market"], r["market"])
        o = out.setdefault(fam, {"family": fam, "n": 0, "sum_prob": 0.0, "sum_hit": 0.0, "sum_brier": 0.0})
        n = int(r["n"])
        o["n"] += n; o["sum_prob"] += float(r["mean_prob"]) * n; o["sum_hit"] += float(r["hit"]) * n; o["sum_brier"] += float(r["brier"]) * n
    res = []
    for o in out.values():
        n = o["n"]
        res.append({"family": o["family"], "n": n, "mean_prob": o["sum_prob"] / n, "hit": o["sum_hit"] / n,
                    "brier": o["sum_brier"] / n, "bias": (o["sum_hit"] - o["sum_prob"]) / n})
    return sorted(res, key=lambda r: r["family"])


def diagnostics(engine: Engine) -> dict:
    """Realised structural rates vs what the closing models predicted."""
    with engine.connect() as c:
        g = c.execute(text("""
            SELECT count(*) AS finals,
                   avg(CASE WHEN reg_home = reg_away THEN 1.0 ELSE 0.0 END) AS reg_tie_rate,
                   avg(CASE WHEN went_so THEN 1.0 ELSE 0.0 END) FILTER (WHERE went_ot) AS so_share_of_ot,
                   avg(final_home + final_away) AS avg_total,
                   avg(reg_home + reg_away) AS avg_reg_total,
                   avg(CASE WHEN final_home > final_away THEN 1.0 ELSE 0.0 END) AS home_win_rate,
                   avg(CASE WHEN abs(reg_home - reg_away) = 1 THEN 1.0 ELSE 0.0 END) AS reg_one_goal_rate,
                   avg(CASE WHEN abs(reg_home - reg_away) = 2 THEN 1.0 ELSE 0.0 END) AS reg_two_goal_rate,
                   avg((periods->0->>0)::int + (periods->0->>1)::int) AS avg_p1,
                   avg((periods->1->>0)::int + (periods->1->>1)::int) AS avg_p2,
                   avg((periods->2->>0)::int + (periods->2->>1)::int) AS avg_p3
            FROM games WHERE status='final' AND reg_home IS NOT NULL
        """)).mappings().first()
        p = c.execute(text("""
            SELECT avg((summary->>'p_draw')::float) AS pred_draw, avg((summary->>'exp_total')::float) AS pred_total,
                   avg((summary->>'exp_reg_total')::float) AS pred_reg_total, avg((summary->>'p_home')::float) AS pred_home,
                   count(*) AS n
            FROM pricing_snapshots s JOIN games g ON g.id = s.game_id
            WHERE s.kind='closing' AND g.status='final'
        """)).mappings().first()
    out = dict(g or {})
    out.update({f"pred_{k}" if not k.startswith("pred_") else k: v for k, v in dict(p or {}).items()})
    tot = (out.get("avg_reg_total") or 0)
    if tot:
        out["p1_share"] = (out.get("avg_p1") or 0) / tot
        out["p2_share"] = (out.get("avg_p2") or 0) / tot
        out["p3_share"] = (out.get("avg_p3") or 0) / tot
    return out
