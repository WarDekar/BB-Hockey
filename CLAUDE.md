# BB-Hockey — Claude Context

**Last updated: 2026-10-20.** This is the Hockey Claude: this repo owns NHL
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
Board (`/slate` rows carry `home_bench` / `away_bench`). The handoff for
BB-CBB's fouling-down-late analogue is in `docs/handoffs/for-bb-cbb/`. A "pull" is a trailing team's
goalie-off gap inside the last ten minutes of regulation (inside 6:00, or at
least 20 s long); the pull rules live in `derive_pulls`. NHL abbreviations
(LAK, NJD, SJS, TBL, UTA) differ from the ESPN ones in `teams.py`.

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
   `coach_eng = 0` in Params falls back to the two league rates.

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
