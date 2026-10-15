"""`python -m bb_hockey.migrate` — apply migrations/*.sql to bb_hockey."""
import logging

from .db import run_migrations

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
applied = run_migrations()
print("applied:", applied or "nothing (up to date)")
