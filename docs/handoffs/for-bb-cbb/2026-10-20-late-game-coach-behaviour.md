# Late-game coach behaviour as a pricing input: what BB-Hockey built, for BB-CBB

**From:** BB-Hockey · **Date:** 2026-10-20 · **For:** BB-CBB (intentional fouling down late)

BB-Hockey now measures how each NHL head coach behaves when his team trails
late (when he pulls the goalie, how early, and what it costs), turns that
into per-coach rates, and feeds them into the pricing model for the puck
line, the ±2.5 alternates and totals. The same shape applies to college
basketball: whether and when a coach starts fouling down late decides
whether a 6-point game ends 10, which is the whole spread and total market.
This note is the recipe, the data model and the lessons, so BB-CBB can do
the same with free throws instead of empty nets.

## 1. The question, stated the betting way

Do not model the behaviour for its own sake. Ask what the market pays for:

| Hockey | Basketball analogue |
|---|---|
| Down 1 inside 3:00 → how often does the team end up losing by 2+ (opponent −1.5 cashes)? | Down 4–8 inside 1:00 → how often does the margin blow past the spread because of fouling? |
| Down 2 inside 3:00 → how often beaten by 3+ (+2.5 fails)? | Down 9–12 → does the coach keep fouling (margin grows) or concede (margin holds)? |
| A goal after 17:00 of the third, either side, OT included → moves a 5.5 / 6 / 6.5 total | Points scored in the last minute from free throws + the trailing team's quick 2s/3s → moves the total |

The headline numbers come straight from outcomes conditional on the late
state, not from the behaviour. The behaviour (pull rate, pull time, free
throw volume) explains *why* and lets you extrapolate to a new coach or a
new deficit. Both matter: the outcome rate is what you feed the model, the
behaviour is what you show the bettor.

## 2. Data sources and what to store

Hockey used three free NHL.com endpoints per final, fetched once and kept
raw (gzipped JSON on disk) so everything downstream can be re-derived
without refetching:

1. **Play-by-play**: every event with the clock, a running score, and a
   situation code (skaters and goalies on ice per side).
2. **Shift charts**: exact on/off times per player, which gives the pull
   to the second (the PBP situation codes are the fallback).
3. **Game info**: the head coach named per team per game. This is what
   makes coach tenures exact, including mid-season firings and interims.

For CBB the equivalents are the play-by-play feed with the clock and score
(ESPN or the NCAA stats feed), and any per-game coach field. If no feed
names the coach per game, build the tenure table from a season list and
patch mid-season changes by hand; the schema below allows it.

Tables (all in the project's own Postgres, see `migrations/002`–`004`):

- `nhl_games`: one row per final with scores, OT/SO flags, both coaches,
  ingest status.
- `nhl_plays`: flat events (period, seconds elapsed, type, situation code,
  running score, details JSON). 1.3M rows for 4,300 games, no problem.
- `nhl_shifts`: shifts with a goalie flag.
- `goalie_pulls`: **one row per episode** (goalie off the ice): deficit at
  the pull, seconds left, duration, goals for/against during it, how it
  ended, and a `kind` (`pull` | `delayed_penalty` | `ot` | `other`). For
  CBB this is "one row per intentional-foul stretch": deficit when it
  started, seconds left, how many fouls, points conceded at the line,
  points scored back, how it ended.
- `coaches`: **league-generic** tenure table `(league, team, coach, role,
  start_date, end_date, games, source)`. NHL rows are derived from
  consecutive games per team with the same named coach. BB-CBB can insert
  its own rows with `league='CBB'`; keep the abbreviation the league's own.
- `pull_situations` (materialized view): **one row per team-game** with the
  set of deficits the team faced inside the last three minutes, the final
  and regulation scores, and goals added after the cut-off. This is the
  table every aggregate reads; the raw plays are never shipped to a page.

## 3. Deriving the behaviour

- Define the **episode** from the cleanest signal you have (shifts for
  hockey; for CBB, a run of fouls by the trailing team with the clock under
  a threshold), then classify it. Hockey needed three rules to avoid false
  positives: a gap is a pull only inside the last ten minutes, only if the
  team trails, and not when a penalty event sits next to it (delayed
  penalty). Expect the equivalent in CBB: fouls that are ordinary defensive
  fouls, fouls while *leading* (fouling up 3 to prevent a tying three),
  end-of-half fouls.
- Define the **situation** independently of the behaviour: "team trailed by
  k at some point with the clock under T". We take the score at the cut-off
  (17:00 of the third) and after every later goal, so a team that falls
  behind at 18:30 still counts. For CBB, T is probably 60–90 seconds and k
  runs 1–12, possibly bucketed by possessions (1, 2, 3, 4+).
- Join situations to episodes by team-game. Per coach × deficit you then
  get: situations, how many had the behaviour, timing quantiles (median,
  IQR, earliest), what happened during it (scored, tied, conceded), and the
  outcome rates the market pays for.
- **Shrink before you use it.** A coach's own rate is blended with the
  league: `rate = (k + w·league) / (n + w)` with `w` ≈ one season of
  situations (40 in hockey). Thin benches (new coaches) fall back to the
  league automatically.

## 4. What the numbers look like (hockey, 2023-24 to date, 4,339 finals)

- Down 1 inside 3:00: 1,774 team-games. 92% pull, median 1:56 left, IQR
  1:34–2:20. 15% tie it, 43% of pulls concede the empty-netter. Final
  margins: 40% lose by 2+, 51% by exactly 1, 8% to OT or win. A further goal
  (either side, OT and shootout goal included) 70% of the time.
- Down 2: 1,647 team-games. 76% pull, median 2:39. 50% of pulls concede.
  39% lose by 3+. A further goal 87% of the time.
- Coach spread is wide and stable: Paul Maurice pulls at 2:25 and concedes
  53%; Jim Montgomery pulls only 69% of the time down one; Scott Arniel
  pulls late (1:40) and concedes 31% down one but always pulls down two and
  concedes 69%. The spread in "loses by 2+ when down 1 late" across benches
  runs from 18% to 64%, which is far more than a market prices.
- The empty-net rate is a function of how early the pull is: under 10% for
  pulls inside 0:30, 45% for pulls at 2:00+. Expect the same shape for
  fouling: the earlier the fouling starts, the more free throws, the larger
  the final margin and the total.

## 5. Feeding the model

The hockey model is a diagonal-inflated bivariate Poisson fitted to the
devigged consensus moneyline and total. Empty-net goals enter as a shift of
probability mass: a share of one-goal regulation leads become two-goal
leads, and a share of two-goal leads become three. Before this work those
shares were one global prior (0.28). Now:

- The league rates are **measured** from the data with the model's own
  definition (0.44 and 0.42) and are the fallback.
- Per game, the rate for a *home* lead is the *away* coach's conversion
  (he is the one pulling), and vice versa, shrunk to the league.
- The rates travel in the pricing snapshot's inputs, so a re-price, the
  closing model and CLV all use the same benches, and a coaching change
  re-prices the game on the next pass.
- The same measured quantities are shown as "cliff notes" per current bench
  (pull rate, timing, loses-by rates, totals rates, with a lean when the gap
  to the league clears 5 points on 12+ games) and as a column on the Board
  next to each game.

For CBB the analogue is the late-game margin distribution: given the
pregame spread and total, the model's margin distribution near the number
should be reshaped by the trailing coach's fouling profile (how early he
starts, how many fouls per 10 seconds, the opponent's free-throw %) rather
than a single league prior. The simplest first version: per coach × deficit
bucket, the empirical distribution of `final margin − margin at 1:00` and
`points in the last minute`, shrunk to the league, applied as a late-game
kernel on top of the pregame model.

## 6. Lessons that cost us time

1. **Status flags from two sources fight.** Our pricer copied the odds
   feed's "completed" flag into the game status and the settlement loop
   only looked at games not yet marked final, so five nights of finals were
   never graded. One writer per status field.
2. **Clip the last period to the game's end.** An OT winner at 19:29 is not
   followed by 31 seconds of empty net. Likewise the last possession.
3. **Short blips are not behaviour.** Delayed-penalty exits looked like
   three-second pulls; expect the same from a loose-ball foul at 0:45.
4. **Keep raw JSON on disk and make derivation idempotent** (`rederive`
   command). Every rule change above was a re-derive, not a refetch.
5. **Aggregate on the server, ship ~150 KB, not raw rows.** Materialize the
   per-team-game table; the page sends filters as query parameters.
6. **Name the coach per game**, not per season. Tenures derived from games
   handle firings and interims for free.

## 7. Where to look

- `bb_hockey/nhl.py` (client), `bb_hockey/pbp.py` (ingest, `derive_pulls`,
  `situations`, `pull_report`, `coach_notes`, `coach_eng_rates`,
  `eng_for_game`), `migrations/002`–`004`.
- API: `GET /pulls` (desk aggregates), `GET /pulls/notes` (cliff notes),
  `/slate` rows carry `home_bench` / `away_bench`.
- UI: Pulls tab (notes + desk), Board "Bench reads" column, game page
  "Empty-net rates".
- Published summary page: https://claude.ai/artifact/RRR3pK7B36TQYRPdzJ4yg2

Cross-project communication stays in `docs/handoffs/`; BB-Hockey never
writes into BB-CBB. Questions back via `docs/handoffs/from-bb-cbb/`.
