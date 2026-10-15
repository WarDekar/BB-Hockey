-- BB-Hockey schema v1 (2026-10-15 rebuild). Own DB `bb_hockey`; BB-Odds is read-only and never
-- referenced by foreign key — `games.id` IS the bb_odds current.games id, copied here so a nightly
-- purge upstream cannot orphan a bet.

CREATE TABLE IF NOT EXISTS games (
    id              integer PRIMARY KEY,                 -- bb_odds games.id
    external_id     text,
    espn_game_id    bigint,
    game_time       timestamptz NOT NULL,
    home_name       text NOT NULL,
    away_name       text NOT NULL,
    home_abbr       text,
    away_abbr       text,
    home_rotation   integer,
    away_rotation   integer,
    status          text,                                -- pregame | live | final | unknown
    final_home      integer,
    final_away      integer,
    reg_home        integer,
    reg_away        integer,
    periods         jsonb,                               -- [[h1,a1],[h2,a2],[h3,a3]]
    went_ot         boolean,
    went_so         boolean,
    result_source   text,
    settled_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_time_idx ON games (game_time);
CREATE INDEX IF NOT EXISTS games_status_idx ON games (status);

CREATE TABLE IF NOT EXISTS pricing_snapshots (
    id              bigserial PRIMARY KEY,
    game_id         integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    kind            text NOT NULL DEFAULT 'live',        -- live | closing
    inputs          jsonb NOT NULL,                      -- p_home, total_point, p_over, sources, assumptions
    params          jsonb NOT NULL,
    summary         jsonb NOT NULL,                      -- lambdas, p_draw, exp totals...
    board           jsonb NOT NULL                       -- [{market, side, point, prob, push, fair_price}]
);
CREATE INDEX IF NOT EXISTS snap_game_time_idx ON pricing_snapshots (game_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS snap_kind_idx ON pricing_snapshots (kind, game_id);

CREATE TABLE IF NOT EXISTS edges (
    id              bigserial PRIMARY KEY,
    snapshot_id     bigint NOT NULL REFERENCES pricing_snapshots(id) ON DELETE CASCADE,
    game_id         integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    market          text NOT NULL,
    side            text NOT NULL,
    point           double precision,
    period_src      text NOT NULL,                       -- bb_odds markets.period the quote came from
    sportsbook_id   integer NOT NULL,
    sportsbook      text NOT NULL,
    book_group      text,
    price           double precision NOT NULL,
    quoted_at       timestamptz,
    fair_prob       double precision NOT NULL,
    push_prob       double precision NOT NULL,
    fair_price      double precision,
    ev              double precision NOT NULL,
    kelly           double precision NOT NULL,
    computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edges_game_idx ON edges (game_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS edges_ev_idx ON edges (computed_at DESC, ev DESC);

CREATE TABLE IF NOT EXISTS paper_bets (
    id              bigserial PRIMARY KEY,
    game_id         integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    market          text NOT NULL,
    side            text NOT NULL,
    point           double precision,
    sportsbook_id   integer,
    sportsbook      text NOT NULL,
    price           double precision NOT NULL,
    stake           double precision NOT NULL,
    fair_prob       double precision NOT NULL,           -- model at placement
    push_prob       double precision NOT NULL,
    ev              double precision NOT NULL,
    kelly           double precision,
    source          text NOT NULL DEFAULT 'auto',        -- auto | manual
    placed_at       timestamptz NOT NULL DEFAULT now(),
    snapshot_id     bigint REFERENCES pricing_snapshots(id) ON DELETE SET NULL,
    status          text NOT NULL DEFAULT 'pending',     -- pending | won | lost | push | void
    pnl             double precision,
    settled_at      timestamptz,
    closing_fair_prob   double precision,                -- model refit on the closing consensus
    closing_price       double precision,                -- same book/market/point last quote pre-start
    clv_model           double precision,                -- closing_fair_prob - fair_prob
    clv_price           double precision,                -- dec(price)/dec(closing_price) - 1
    note            text
);
CREATE INDEX IF NOT EXISTS bets_game_idx ON paper_bets (game_id);
CREATE INDEX IF NOT EXISTS bets_status_idx ON paper_bets (status, placed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS bets_auto_once ON paper_bets (game_id, market, side, point, sportsbook) WHERE source = 'auto';

CREATE TABLE IF NOT EXISTS calibration_obs (
    id              bigserial PRIMARY KEY,
    game_id         integer NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    market          text NOT NULL,
    side            text NOT NULL,
    point           double precision,
    prob            double precision NOT NULL,
    outcome         smallint,                            -- 1 win, 0 loss, NULL push
    kind            text NOT NULL DEFAULT 'closing',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, market, side, point, kind)
);

CREATE TABLE IF NOT EXISTS settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_heartbeat (
    job             text PRIMARY KEY,
    last_run_at     timestamptz NOT NULL,
    ok              boolean NOT NULL DEFAULT true,
    note            text
);
