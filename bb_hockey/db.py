"""Two engines: BB-Odds (read-only, enforced at the session level) and bb_hockey (ours).

Migrations are plain SQL files in ``migrations/`` applied in name order and
recorded in ``schema_migrations``; ``python -m bb_hockey.migrate`` runs them.
"""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import REPO, settings

logger = logging.getLogger(__name__)

_odds: Engine | None = None
_hockey: Engine | None = None


def odds_engine() -> Engine:
    """Read-only. ``default_transaction_read_only`` makes any write a server error."""
    global _odds
    if _odds is None:
        _odds = create_engine(
            settings.dsn_sqlalchemy(settings.odds_dsn),
            pool_pre_ping=True, pool_size=3, max_overflow=2,
            connect_args={"options": "-c default_transaction_read_only=on -c statement_timeout=20000"},
        )
    return _odds


def hockey_engine() -> Engine:
    global _hockey
    if _hockey is None:
        _hockey = create_engine(settings.dsn_sqlalchemy(settings.hockey_dsn), pool_pre_ping=True, pool_size=5, max_overflow=5)
    return _hockey


def run_migrations(engine: Engine | None = None) -> list:
    engine = engine or hockey_engine()
    applied = []
    with engine.begin() as c:
        c.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"))
        done = {r[0] for r in c.execute(text("SELECT name FROM schema_migrations"))}
    for f in sorted((REPO / "migrations").glob("*.sql")):
        if f.name in done:
            continue
        sql = f.read_text()
        with engine.begin() as c:
            c.exec_driver_sql(sql)
            c.execute(text("INSERT INTO schema_migrations(name) VALUES (:n)"), {"n": f.name})
        applied.append(f.name)
        logger.info("applied migration %s", f.name)
    return applied
