# BB-Hockey — Claude Context

**Last updated: 2026-10-21.** This is the Hockey Claude: this repo owns NHL
derivative pricing in the `~/Dev` fleet. Cross-project communication happens
only through `docs/handoffs/` markdown (see `Brandos-World/conventions/`).

## What this is

An NHL derivative pricer. Inputs are BB-Odds's de-vigged consensus moneyline
and total (synthetic sportsbook `market_consensus`, id 413, in
`bb_odds.current.odds`). A diagonal-inflated Poisson goals model with
empty-net and OT/shootout handling is fitted to those two numbers per game
and prices puck lines and alternates, the 60-minute 3-way, game / regulation /
team / period totals, and first-period lines. Every book quote in BB-Odds is
marked to the model; edges are paper-bet automatically (best price, quarter
Kelly, 1-unit cap); finals come from ESPN; CLV is measured against the
consensus close (model) and the same book's closing quote (price); every
priced side of the closing board becomes a calibration observation.

**Paper only, research first. Never places a bet anywhere.**

## Status — 2026-10-15: rebuilt from scratch, live on kamel

The original (2026-10-14) codebase was lost with the mac-mini (never pushed;
GitHub had an empty README). Everything here was rebuilt in one session on
2026-10-15 and is running:

| | |
|---|---|
| PM2 | `bb-hockey-backend` (:5018, FastAPI + Socket.IO + in-process worker), `bb-hockey-frontend` (:3018, vite preview) — in `pm2 save` |
| Gateway | `handle /hockey/*` → :3018 (already in `Brandos-World/Caddyfile`); `/hockey/` returns 200 |
| DB | `bb_hockey` on the local PG17 (`drkamel`, trust auth), 8 tables, migration `001_init.sql` applied |
| Reads | `bb_odds.current` (slate, consensus, quotes) and `bb_odds.main` (closing history) through a read-only engine (`default_transaction_read_only=on`) |
| Worker | pricing every 60 s, settlement every 300 s; heartbeats in `worker_heartbeat`, `/health` says `degraded` when stale |
| First slate | 16 games, 13 priced (3 had no consensus yet), ~90 quotes above 3% EV, auto-paper placed |
| Tests | 18 passing (`./.venv/bin/python -m pytest -q`), no DB needed |

**Settlement verified 2026-10-20.** Two bugs hid it for five nights: `upsert_game`
copied BB-Odds's `completed` flag into `games.status='final'`, and `settle_pass`
only looked at `status <> 'final'`, so 36 of the first 40 finals were never
graded. Now BB-Odds can only move a game to `live`; `final` is set by
settlement alone, and `settle_pass` keys on `settled_at IS NULL`. The
closing-quote lookup also failed on an untyped NULL bind (`CAST(:pt AS float8)`).
After the catch-up: 40 finals graded, 256 bets settled (+6.1% ROI on paper,
avg model CLV −0.7%, price CLV available on about half the bets), 5,980
calibration observations. `POST /hockey/api/run/settlement` forces a pass.

## NHL play-by-play and goalie pulls (added 2026-10-20)

`bb_hockey/nhl.py` (client) and `bb_hockey/pbp.py` (ingest, derivation, analysis)
pull every regular-season and playoff final from NHL.com: gamecenter
play-by-play (events + 4-digit situation codes: away goalie, away skaters,
home skaters, home goalie), the stats shift charts (exact goalie on/off
times) and the right-rail (head coach per team per game). Raw JSON is gzipped
under `data/nhl/<season>/` (gitignored) so tables can be rebuilt offline
(`python -m bb_hockey.pbp rederive`). Tables: `nhl_games`, `nhl_plays`,
`nhl_shifts`, `goalie_pulls` (one row per goalie-off interval: `kind` is
`pull` | `ot` | `delayed_penalty` | `other`, deficit and seconds left at the
pull, goals for/against during it, how it ended) and the league-generic
`coaches` tenure table (derived from consecutive games per team, so interims
and mid-season changes are their own rows; other leagues can be loaded with
their own `source`). Backfilled 2023-24, 2024-25, 2025-26 and 2026-27 to date;
the worker's `pbp` job ingests new finals every 30 min (`POST
/hockey/api/run/pbp` forces it). The Pulls tab aggregates `GET /pulls` per
coach: pull rate when down 1 / 2 / 3+ inside 3:00, median and IQR of time
left, scored / tied / empty-netter rates. `GET /pulls/notes` is the cliff
notes per current bench (puck-line, +2.5 and totals leans from late-deficit
outcomes), shown as the Pulls tab's default view and as "Bench reads" on the
Board (`/slate` rows carry `home_bench` / `away_bench`). The Board, Edges and Bets tables show the matchup as Away / @ / Home columns with fixed-width rotation and code boxes (`TeamTag pad`; `/edges` and the ledger carry the rotations), bench reads are Away bench / Home bench columns, and the consensus over / under price sits beside the total. The handoff for
BB-CBB's fouling-down-late analogue is in `docs/handoffs/for-bb-cbb/`. A "pull" is a trailing team's
goalie-off gap inside the last ten minutes of regulation (inside 6:00, or at
least 20 s long); the pull rules live in `derive_pulls`. NHL abbreviations
(LAK, NJD, SJS, TBL, UTA) differ from the ESPN ones in `teams.py`.

## Edges board (2026-10-20)

`edges` holds **every** evaluated quote of the latest pass per game (EV
down to `store_min_ev` −1.0, capped at `max_edge`), not just positive ones:
the Edges tab fetches `/edges?min_ev=-1` and its min-EV box (can go
negative) filters, so the books dropdown lists the whole board. Pregame
quotes count for `quote_max_age_min` = 720 minutes: `current.odds` is each
book's standing line and Pinnacle/DK/Bet365 go hours without a change, so a
30-minute window (the original) silently dropped most of the board.
**Only the `oddslogic` and `bb_poly` feeds count (`quote_sources`, 2026-10-23):**
BB-Odds still carries `donbest_live` rows for ~90 books (the lapsed DonBest
subscription), a second copy of books OddsLogic has live (BetOnline 1393 beside
713, DK 1563 beside 722, WPH 1383 beside 737), 10+ hours stale on a game day;
MTL −1.5 showed BetOnline +174 (DonBest, 04:14) next to +157 (OddsLogic, 09:31)
and 80% of the board was those rows. `books_active_only` adds BB-Odds's own
grid rule (`sportsbooks.active`, what Top Bets uses); it is off because the
operator keeps the exchanges and per-head books off that grid. The 45 paper
bets placed on those rows carry `paper_bets.flag = 'stale_feed'` (migration
007): the 4 open ones were voided, the 41 settled stay in the ledger with a ⚑
pill but are outside the summary, the by-market table and Results (they are
reported under `summary.flagged`). Games
the worker cannot price in a pass lose their edges, and `/edges` only
returns rows from the last 20 minutes, so nothing survives a model change.
The API gzips responses (the raw board is ~3 MB) and `useApi` keeps the last payload per path for the session, so a tab switch renders at once and refreshes behind (timer and worker pushes within 15 s of a load are coalesced). The three filter bars persist to `localStorage`; an empty books list
("None") is never restored (it comes back as all books), because a saved
empty selection showed "0 of 3,668" with a misleading min-EV message.

## Display rules (fleet, from BB-Odds's frontend CLAUDE.md; 2026-10-21)

Teams always render with logos (`TeamLogo`: slate-300 circular backing,
inset padding, hides itself on a dead link, never inlined), books with
`BookBadge` (file in `web/src/assets/books/` by slug, else a brand
monogram), structured tooltips with `HoverTip` (portal card, never a native
`title`), rotation numbers mono-gray beside the teams on the Board. Team
identity comes from BB-Odds (`current.espn_teams` via
`odds_reader.espn_teams`, served by `GET /teams`, cached an hour) and is
resolved at read time in `web/src/lib/teams.ts`, never stored. `Matchup`,
`TeamTag` and `SideCell` in `TeamMark.tsx` are the cells every table uses.
NHL.com codes (LAK, NJD, SJS, TBL) map to the ESPN ones before lookup.

## Hard rules

- **Edits stay inside this repo.** Read sibling repos freely; never write to them.
- **`bb_odds` is read-only.** The engine enforces it; keep every query in `odds_reader.py`.
- **Always `./.venv/bin/python`**, never bare `python` (fleet rule; system Python is 3.14).
- **Never auto-place anything real.** `paper_bets` is a ledger, not an order book.
- **Snapshots are append-only**; `edges` holds only the latest pass per game (delete+insert).
- **Development on `main`**, no feature branches (fleet convention). Push after every working change — the project was lost once for not doing this.

## Assumptions to keep in view

1. **Hockey period slots in BB-Odds.** `1q` = first period (Pinnacle, Bet365,
   BetMGM, BetOnline, FanDuel… spread ±0.5, total 1.5), `1h` = first period
   from the Circa/per-head feed (identical numbers to the same book's `1q`
   on 2026-10-15), `2h` = second period (total 2). Mapped in
   `odds_reader.PERIOD_MAP`; `live` is ignored. Inferred from quoted points
   and cross-book agreement, not documentation — handoff sent to BB-Odds.
2. **Period moneylines are two-way, tie pushes** (Pinnacle P1 −112/−104 is a
   ~4% hold two-way, not a 3-way). Graded accordingly (`p1_ml` push on tie).
3. **Totals rows carry the OVER on the home side** (BB-Odds convention, same as
   their `closing_line.py`).
4. **The 1q consensus is noisier than the game consensus** — BB-Odds's push-rate
   shift across books at 1.5 / 2 / 2.5 produced an over-1.5 fair of 45.8% for
   BUF@TOR while every book at 1.5 was −150. The model does **not** use the 1q
   consensus as an input, only as a diagnostic (`market_check`).
5. **Per-head books (ParadiseWager / WPH / BetWar / AcesHigh / SweatAG) post
   first-period totals ~0.3 goals above Pinnacle.** That is where the large
   first-period unders come from. They are real quotes at books the operator
   has accounts at (BB-Betting scrapes Paradise), so they are shown; anything
   above `max_edge` (20%) is treated as a stale/mis-mapped quote and not
   auto-papered.
6. **Model priors** (`ModelParams`): draw inflation 1.45, OT decided share
   0.65, period shares 0.30/0.335/0.365. The Calibration tab compares
   realised rates to these; change them in Params when the sample says so.
   **Empty-net rates are measured, not priors (2026-10-20):** of one-goal
   leads 0.44 pick up the empty-netter, of two-goal leads 0.42 become three
   (NHL.com PBP, 1,625 / 1,500 cases). Per game the rate for a HOME lead is
   the AWAY coach's own conversion (he pulls), shrunk to the league with
   `eng_prior_games` = 40, via `pbp.eng_for_game`; the rates ride in the
   snapshot `inputs.eng` so re-pricing, the closing model and CLV agree.
   `coach_eng = 0` in Params falls back to the two league rates. Also measured:
   `eng_chain` 0.18 (a second empty-netter after the first) and `eng_rate3`
   0.14 (three-goal leads → four). Validated on 1,743 historical finals with
   closing lines (SBR archive, 2021-22 + Oct–Nov 2022): fav −1.5 39.9% model
   vs 41.4% real (market 40.4%), −2.5 26.9 vs 29.0, dog +2.5 73.1 vs 71.0,
   dog by 2+ 22.6 vs 19.4, any 2+ margin 62.5 vs 60.8. Favourites won 63.7%
   in that sample against 61.1% priced, which explains most of the residual
   on both sides, so the shape is kept symmetric. A strength mixture
   (`strength_sigma`) was tried and rejected: it matched the favourite side
   by overstating underdog blowouts (any 2+ margin 64.9%). Remaining known
   residuals: at ≥68% favourites the dog +2.5 is better than modelled;
   three-goal games are ~2 points over-produced. See
   `docs/model/2026-10-20-baseline-validation.md`.
   **Late-game kernel (2026-10-21, `late_kernel`, default on):** the Poisson
   pair runs to 17:00 of the third and the last three minutes come from
   `goals.LATE_KERNEL`, the measured distribution of (leader adds, trailer
   adds) regulation goals by margin at 17:00 (4,343 PBP finals; `python -m
   bb_hockey.pbp kernel` re-measures it). It replaces the empty-net mass
   shifts (`eng_chain` / `eng_rate3` are old-path only); the coach rates
   move the kernel's empty-net branch by their odds ratio against
   `eng_rate` / `eng_rate2`. `draw_inflation` applies at 17:00 and is 1.20
   (1.45 was the full-game value); `ot_decided_share` 0.68 measured. On the
   1,743 finals it fixed the totals parity (odd totals 67.9% vs 67.5% real,
   was 65.6%; exact 6 at 6.0 lines 11.1% vs 9.4%, was 11.7%) and the
   alternates (fav −2.5 28.1 vs 29.0, dog +2.5 71.9 vs 71.0) at the cost of
   0.6 points on the fav −1.5 (39.3 vs 41.4).
   **Coach late-goal rate and the baseline-rate fit (2026-10-21 pm):** the
   trailing coach's "a goal after 17:00" rate (any regulation goal given
   down 1 / 2 at 17:00, the kernel's own definition; `goal1` / `goal2` in
   `coach_eng_rates`, keys `*_lead{1,2}_goal` in `inputs.eng.rates`) rakes
   the kernel's (0,0) cell by its odds ratio against the league's, jointly
   with the empty-net conversion. The league rate equals 1 − the kernel's
   (0,0) by construction (63.1% / 75.1%). `bench_refit` (default off) is
   the other half: the rates are now solved at **league** benches and the
   coach kernels applied at those rates, so the fair total and, through
   the tying-goal branch, the ML drift from the market by what the benches
   do (about ±0.8 points on the total at the line, ±0.7 on the ML across
   a slate). With `bench_refit` on, the old behaviour: the market ML and
   total are reproduced with the coach rates, so a bench only reshapes
   the distribution and the fair total never leaves the line.
   `kernel_pace_k` (0.5) scales the kernel's late goals with
   `(λh+λa)/kernel_pace_ref` (5.69); the PBP cannot measure the elasticity
   (team pace spans ±4%) and the historical set is indifferent between 0
   and 1, so 0.5 is a structural prior, worth about ±0.4 points on the
   alternates at 7.0 or 5.5 lines.
   **Auto-paper skips Bet105's spreads** (`auto_paper_exclude`, 2026-10-23): BB-Odds
   writes two line sets for Bet105 spreads and alternates them every push (handoff
   2026-10-21), so the side falls to the next-best book; the quotes still show on
   the Edges tab. Clear the setting once BB-Odds keeps one line set per book.
   **Exchange quotes are mids.** BB-Odds stores Polymarket (ids 700/761) and
   Kalshi (760) at the bid/ask midpoint (the ±1.5 pair shows identical
   prices), which BB-Odds's own notes call phantom +EV; `edges.py` applies a
   per-book taker haircut (`exchange_haircut`) before EV, and the UI shows the
   price as quoted with the haircut noted.
7. **Every live snapshot carries a league-baseline board** (`board_base`,
   `summary.baseline`): the same ML + total with league-average empty-net
   rates. Edges carry `base_prob` / `base_ev`; the Edges tab's source chips
   split bench-driven edges from ones that exist at baseline too.

## Key files

| Path | Role |
|---|---|
| `bb_hockey/model/goals.py` | the model; `prob_for(market, side, point)` is the one lookup everything uses |
| `bb_hockey/pricer.py` | `build_inputs` (Shin de-vig of the consensus), `fit_from_inputs`, snapshots, `market_check` |
| `bb_hockey/edges.py` | `market_key(market_type, period)`, `evaluate_quotes`, `best_per_side` |
| `bb_hockey/paper.py` | `auto_paper` (excludes `ml`), stakes, ledger, `summary` |
| `bb_hockey/settlement.py` | `grade` (every market), `closing_model` (main.odds → last live snapshot fallback), `clv_for_bet`, `settle_pass` |
| `bb_hockey/espn.py` | ESPN summary/scoreboard parsing: linescores `[P1,P2,P3,OT?,SO?]` |
| `bb_hockey/teams.py` | 32 clubs, BB-Odds spelling → ESPN abbreviation |
| `bb_hockey/worker.py` | `pricing_pass`, `settlement_pass`, `run_forever` |
| `bb_hockey/api/routes.py`, `main.py` | API, Socket.IO on both paths, SPA host |
| `web/src/App.tsx` | header (fleet brand block), tabs, hash routing (`#game=ID`) |
| `web/src/components/` | Board, GameDetail, Edges, Bets, Results, Calibration, Params, Primitives |

## Market vocabulary

`ml`, `3way`, `puck`, `total`, `reg_total`, `team_total_home`, `team_total_away`,
`p{1,2,3}_ml` (tie pushes), `p{k}_3way`, `p{k}_spread`, `p{k}_total`. Sides:
`home | away | draw | over | under`. Points are the side's own point (home
−1.5 ↔ away +1.5). Fair price shown is win-vs-lose with pushes conditioned out.

## Next

1. **Review the first week of results** in the Results and Calibration tabs;
   `p1_total` is the one losing market so far and its model CLV is ~0, which
   is what a fixed P1 share prior would produce (see item 2).
2. **Period anchoring** (optional): fit P1 share per game to the 1q consensus
   total instead of the global prior, once the 1q consensus is trusted.
3. **Regulation-total and team-total quotes** are not in BB-Odds, so those
   markets are fair-only; if BB-Odds adds them, extend `edges.market_key`.
4. **Calibration-driven priors**: after a few hundred finals, refit
   `draw_inflation`, `eng_rate`, period shares from the Calibration tab.
   Done 2026-10-20 for the empty-net rates (see Assumptions 6). Next: let
   the Calibration tab's puck / alt-line families confirm the 0.44 / 0.42
   league rates and the coach blend as finals accumulate; `coach_eng = 0`
   is the A/B switch.
5. Portal/PORTS.md status flip is in `docs/handoffs/for-brandos-world/`.
6. **Fallback anchors when BB-Odds has no NHL consensus** (DonBest subscription
   is expired; NHL rows currently come from the OddsLogic feed). The umbrella
   session's collision note (`docs/handoffs/from-brandos-world/`) probed what
   works from this box: ESPN's scoreboard embeds a DraftKings ML/spread/total
   per game, Kalshi lists every NHL derivative (`KXNHLSPREAD`, `KXNHLTOTAL`,
   `KXNHL{1,2,3}P…`) with prices in the `*_dollars` fields, Polymarket Gamma
   has per-game ML/spread/total. Pinnacle is geo-blocked here. A
   `build_inputs` fallback from ESPN/DK would keep the pricer alive without
   BB-Odds; Kalshi's period markets would be a second quote source for edges.

## 2026-10-15 collision

The Brandos-World session also built in this checkout between ~14:05 and
14:25 PT before noticing this session; it moved its work to its scratchpad
and left `docs/handoffs/from-brandos-world/2026-10-15-collision-note.md`. It
overwrote `.gitignore`, `.env`, `pyproject.toml`, `.env.example` and
`tests/test_model.py` (all restored here) and left extra packages in `.venv`
(harmless). `bb_hockey` tables and rows were untouched.
