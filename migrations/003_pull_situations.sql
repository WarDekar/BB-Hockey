-- Per team-game "situations" for the goalie-pull desk, materialized so the API aggregates
-- over a few thousand narrow rows instead of re-reading nhl_plays on every request.
-- late_deficits: the deficits the team faced inside the last three minutes of regulation
-- (score at 17:00 of P3, then after each later goal). Refreshed after every ingest.
CREATE MATERIALIZED VIEW IF NOT EXISTS pull_situations AS
WITH at1700 AS (
    SELECT g.id AS game_id, l.away_score, l.home_score
    FROM nhl_games g
    LEFT JOIN LATERAL (
        SELECT away_score, home_score FROM nhl_plays p
        WHERE p.game_id = g.id AND (p.period < 3 OR (p.period = 3 AND p.elapsed_s <= 1020))
        ORDER BY p.period DESC, p.elapsed_s DESC, p.sort_order DESC LIMIT 1) l ON true
    WHERE g.error IS NULL AND g.game_type IN (2, 3)
),
late AS (
    SELECT game_id, away_score, home_score FROM nhl_plays WHERE type = 'goal' AND period = 3 AND elapsed_s > 1020
),
sides AS (
    SELECT g.id AS game_id, g.season, g.game_type, g.game_date, g.pull_source,
           t.team, t.is_home, t.coach, t.opp, t.opp_coach,
           CASE WHEN t.is_home THEN g.home_score ELSE g.away_score END AS final_for,
           CASE WHEN t.is_home THEN g.away_score ELSE g.home_score END AS final_against,
           CASE WHEN t.is_home THEN g.reg_home ELSE g.reg_away END AS reg_for,
           CASE WHEN t.is_home THEN g.reg_away ELSE g.reg_home END AS reg_against,
           g.went_ot, g.went_so, a.away_score AS a1700, a.home_score AS h1700
    FROM nhl_games g
    JOIN at1700 a ON a.game_id = g.id
    CROSS JOIN LATERAL (VALUES (g.home_abbr, true, g.home_coach, g.away_abbr, g.away_coach),
                               (g.away_abbr, false, g.away_coach, g.home_abbr, g.home_coach)) AS t(team, is_home, coach, opp, opp_coach)
)
SELECT game_id, season, game_type, game_date, pull_source, team, is_home, coach, opp, opp_coach,
       final_for, final_against, reg_for, reg_against, went_ot, went_so,
       ARRAY(SELECT DISTINCT d FROM (
           SELECT CASE WHEN s.is_home THEN s.a1700 - s.h1700 ELSE s.h1700 - s.a1700 END AS d WHERE s.a1700 IS NOT NULL
           UNION ALL
           SELECT CASE WHEN s.is_home THEN lg.away_score - lg.home_score ELSE lg.home_score - lg.away_score END
           FROM late lg WHERE lg.game_id = s.game_id
       ) q WHERE d IS NOT NULL ORDER BY d) AS late_deficits
FROM sides s;
CREATE UNIQUE INDEX IF NOT EXISTS pull_situations_pk ON pull_situations (game_id, team);
CREATE INDEX IF NOT EXISTS pull_situations_coach_idx ON pull_situations (coach, season);
