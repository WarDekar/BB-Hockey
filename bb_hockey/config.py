"""Settings from the environment / .env (gitignored; see .env.example)."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO / ".env", env_prefix="BB_HOCKEY_", extra="ignore")

    port: int = 5018
    prefix: str = "/hockey"
    odds_dsn: str = "postgresql://drkamel@localhost:5432/bb_odds"
    hockey_dsn: str = "postgresql://drkamel@localhost:5432/bb_hockey"

    price_interval: int = 60          # seconds between pricing passes
    settle_interval: int = 300        # seconds between settlement passes
    pbp_interval: int = 1800          # seconds between NHL play-by-play ingest passes
    slate_hours_ahead: int = 48
    quote_max_age_min: int = 720      # a pregame book quote older than this is ignored; current.odds is each book's standing line, so hours-old is normal (the Edges tab shows the age)
    # BB-Odds feeds whose quotes count. `donbest_live` is left out: the subscription lapsed and its rows are a
    # second copy of books OddsLogic carries live (BetOnline 1393 beside 713), 10+ hours stale on a game day.
    quote_sources: tuple = ("oddslogic", "bb_poly")
    books_active_only: bool = False   # True = only books shown on the operator's BB-Odds grid (what Top Bets uses)
    close_grace_min: int = 45         # BB-Odds closing_line.py: how far past start the close may sit
    close_lookback_h: int = 36

    auto_paper: bool = True
    min_edge: float = 0.03            # EV per unit to auto-paper
    max_edge: float = 0.20            # above this it is a stale or mis-mapped quote, not an edge
    store_min_ev: float = -1.0        # every evaluated quote is kept (negative EV included) so the Edges tab can show the whole board
    kelly_fraction: float = 0.25
    unit: float = 100.0
    max_stake_units: float = 1.0
    min_books_for_market: int = 1
    # Exchanges whose BB-Odds row is a bid/ask midpoint, not a takeable price. Polymarket asks are read from
    # bb_poly.poly_markets when present; otherwise (and for Kalshi) the mid is worsened by this many probability points.
    exchange_mid_books: tuple = ("Polymarket", "Kalshi")
    exchange_haircut_prob: float = 0.025
    # Book:market pairs auto-paper skips (the side falls to the next-best book); "Book:*" is every market.
    # Bet105's spreads alternate between two line sets every push in BB-Odds (handoff 2026-10-21), so a
    # +220 there may be +212 on the site; off the list once BB-Odds keeps one line set per book.
    auto_paper_exclude: tuple = ("Bet105:puck", "Bet105:p1_spread", "Bet105:p2_spread", "Bet105:p3_spread")

    devig_method: str = "shin"

    def dsn_sqlalchemy(self, dsn: str) -> str:
        return dsn.replace("postgresql://", "postgresql+psycopg://", 1)


settings = Settings()

# BB_ODDS_DSN / BB_HOCKEY_DSN without the prefix are the fleet spelling; honour them too.
import os as _os  # noqa: E402

if _os.environ.get("BB_ODDS_DSN"):
    settings.odds_dsn = _os.environ["BB_ODDS_DSN"]
if _os.environ.get("BB_HOCKEY_DSN"):
    settings.hockey_dsn = _os.environ["BB_HOCKEY_DSN"]
