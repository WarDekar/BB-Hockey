-- NHL.com play-by-play, shift charts and derived goalie-pull episodes (2026-10-20).
-- Source: api-web.nhle.com gamecenter {play-by-play, right-rail} and api.nhle.com shiftcharts.
-- Raw JSON is kept gzipped under data/nhl/<season>/ so everything here can be re-derived offline.

CREATE TABLE IF NOT EXISTS nhl_games (
    id              bigint PRIMARY KEY,                  -- NHL game id, e.g. 2026020138
    season          integer NOT NULL,                    -- 20262027
    game_type       smallint NOT NULL,                   -- 1 pre, 2 regular, 3 playoffs
    game_date       date NOT NULL,
    start_utc       timestamptz,
    home_abbr       text NOT NULL, away_abbr text NOT NULL,
    home_id         integer, away_id integer,
    home_score      integer, away_score integer,
    reg_home        integer, reg_away integer,
    reg_periods     smallint, went_ot boolean, went_so boolean,
    state           text,                                -- OFF (official) | FINAL
    home_coach      text, away_coach text,
    n_plays         integer, n_shifts integer,
    pull_source     text,                                -- shifts | pbp
    ingested_at     timestamptz,
    error           text
);
CREATE INDEX IF NOT EXISTS nhl_games_date_idx ON nhl_games (game_date);
CREATE INDEX IF NOT EXISTS nhl_games_season_idx ON nhl_games (season, game_type);

CREATE TABLE IF NOT EXISTS nhl_plays (
    game_id         bigint NOT NULL REFERENCES nhl_games(id) ON DELETE CASCADE,
    event_id        integer NOT NULL,
    sort_order      integer NOT NULL,
    period          smallint NOT NULL,
    period_type     text NOT NULL,                       -- REG | OT | SO
    elapsed_s       integer NOT NULL,                    -- seconds into the period
    remaining_s     integer,
    type_code       integer, type text NOT NULL,
    situation_code  text,                                -- away goalie, away skaters, home skaters, home goalie
    owner_team_id   integer,
    away_score      integer NOT NULL, home_score integer NOT NULL,   -- after this event
    details         jsonb,
    PRIMARY KEY (game_id, event_id)
);
CREATE INDEX IF NOT EXISTS nhl_plays_type_idx ON nhl_plays (type, game_id);

CREATE TABLE IF NOT EXISTS nhl_shifts (
    game_id         bigint NOT NULL REFERENCES nhl_games(id) ON DELETE CASCADE,
    shift_id        bigint NOT NULL,
    player_id       integer NOT NULL,
    player_name     text,
    team_abbr       text NOT NULL,
    is_goalie       boolean NOT NULL DEFAULT false,
    period          smallint NOT NULL,
    start_s         integer NOT NULL, end_s integer NOT NULL,
    PRIMARY KEY (game_id, shift_id)
);
CREATE INDEX IF NOT EXISTS nhl_shifts_goalie_idx ON nhl_shifts (game_id, team_abbr) WHERE is_goalie;

-- One row per interval the goalie was off the ice (from shift charts; play-by-play situation codes as fallback).
CREATE TABLE IF NOT EXISTS goalie_pulls (
    id              bigserial PRIMARY KEY,
    game_id         bigint NOT NULL REFERENCES nhl_games(id) ON DELETE CASCADE,
    season          integer NOT NULL, game_type smallint NOT NULL, game_date date NOT NULL,
    team_abbr       text NOT NULL, is_home boolean NOT NULL, coach text,
    opp_abbr        text NOT NULL, opp_coach text,
    episode_no      smallint NOT NULL,                   -- 1st, 2nd... pull in the game for this team
    kind            text NOT NULL,                       -- pull | ot | other
    source          text NOT NULL,                       -- shifts | pbp
    period          smallint NOT NULL, period_type text NOT NULL,
    pull_elapsed_s  integer NOT NULL,                    -- into the period
    pull_remaining_s integer NOT NULL,                   -- regulation seconds left at the pull (OT: seconds left in OT)
    end_elapsed_s   integer NOT NULL, duration_s integer NOT NULL,
    ended_by        text NOT NULL,                       -- goal_for | goal_against | returned | period_end
    score_for       integer NOT NULL, score_against integer NOT NULL, deficit integer NOT NULL,
    goals_for       integer NOT NULL, goals_against integer NOT NULL,   -- during the episode
    final_for       integer NOT NULL, final_against integer NOT NULL,
    reg_for         integer NOT NULL, reg_against integer NOT NULL,
    went_ot         boolean NOT NULL,
    UNIQUE (game_id, team_abbr, episode_no)
);
CREATE INDEX IF NOT EXISTS pulls_coach_idx ON goalie_pulls (coach, kind, deficit);
CREATE INDEX IF NOT EXISTS pulls_team_idx ON goalie_pulls (team_abbr, season);

-- League-agnostic coaching tenures. NHL rows are derived from the head coach named on each
-- game (nhl_games.home_coach / away_coach): a stretch of consecutive games with the same
-- coach is one tenure, so a mid-season replacement or an interim shows as its own row.
-- Other leagues can be loaded by hand or from their own feeds (set `source`).
CREATE TABLE IF NOT EXISTS coaches (
    id              bigserial PRIMARY KEY,
    league          text NOT NULL,                       -- NHL | NFL | MLB | ...
    team            text NOT NULL,                       -- the league's own abbreviation
    coach           text NOT NULL,
    role            text NOT NULL DEFAULT 'head',
    start_date      date NOT NULL,                       -- first game of the stretch
    end_date        date,                                -- last game of the stretch; NULL while current
    games           integer,
    source          text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (league, team, coach, start_date)
);
CREATE INDEX IF NOT EXISTS coaches_lookup_idx ON coaches (league, team, start_date);
