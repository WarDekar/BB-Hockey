# BB-Hockey

NHL derivative pricer for the BBrando fleet. Takes BB-Odds's de-vigged consensus
moneyline and total for every NHL game, fits a goals model to them, and prices
the derivatives the books hang off those two numbers: puck lines and alternates,
the 60-minute 3-way, game / regulation / team / period totals, and first-period
lines. Every book quote in BB-Odds is then marked against the model, edges are
paper-bet automatically, finals are settled from ESPN with closing-line value,
and every priced probability becomes a calibration observation.

**Paper only. Research first.** Nothing here places a bet anywhere.

Fleet slot **18**: backend `:5018`, frontend `:3018`, gateway path `/hockey/`
(registry: `Brandos-World/PORTS.md`). Rebuilt from scratch on kamel on
2026-10-15 after the original code was lost with the mac-mini.

## How it works

```
bb_odds (read-only)                 bb_hockey (ours)
 current.odds  book 413 ──► fair ML + fair total ──► fit (λ_home, λ_away)
 (Market Consensus)                                   │
                                                      ▼
                                   GameModel: diagonal-inflated Poisson regulation
                                   scores + empty-net shift + OT/SO resolution +
                                   per-period rates ──► board of fair probabilities
                                                      │
 current.odds  every book ──► evaluate_quotes ◄───────┘
                              EV / Kelly per side ──► edges ──► auto paper bets
 main.odds (history) ──► closing consensus ──► closing model ──► CLV, calibration
 ESPN summary ──► final, periods, OT/SO ──► grade bets, settle
```

The model (`bb_hockey/model/goals.py`):

- Regulation goals: independent Poisson(λ_h), Poisson(λ_a) with the tied
  diagonal inflated (`draw_inflation`, default 1.45 → ~23% regulation ties
  against ~17% for plain independence). Karlis & Ntzoufras's diagonal-inflated
  bivariate Poisson.
- Empty-net goals: `eng_rate` (0.28) of one-goal regulation wins become two-goal
  wins; the goal counts on the total. This is what prices −1.5 correctly.
- Tied after 60: `ot_decided_share` (0.65) decided in OT, the rest in the
  shootout; the home side's chance is 0.5 plus a small skill tilt. The winner's
  goal counts for one on the total and gives a one-goal margin.
- Periods: shares (0.30 / 0.335 / 0.365) of the regulation rates, own smaller
  diagonal inflation.
- The two rates are solved so the model reproduces the fair home probability
  and the fair over probability at the quoted total exactly (`fit_lambdas`).

On the first live slate (2026-10-15, 13 games) the model's puck −1.5 fair was
within 0.4 points of BB-Odds's own consensus on average, the first-period
moneyline within 0.3 points, the first-period over 1.5 about 2 points high.
Those checks are recorded in every snapshot (`summary.market_check`) and shown
on the game page.

## Run

```bash
# Postgres: bb_odds (read) and bb_hockey (ours) on the local PG17
./.venv/bin/python -m bb_hockey.migrate            # applies migrations/*.sql

pm2 start ecosystem.config.js && pm2 save          # bb-hockey-backend :5018, bb-hockey-frontend :3018
open http://localhost/hockey/                      # via the gateway

# Manual
./.venv/bin/python -m uvicorn bb_hockey.api.main:asgi --host 0.0.0.0 --port 5018
cd web && npm run build && npm run preview         # :3018
./.venv/bin/python -m pytest -q                    # 18 tests, no DB needed
```

Fresh environment: `uv venv -p 3.12 .venv && uv pip install --python
.venv/bin/python -r requirements.txt`; `cd web && npm install`. Copy
`.env.example` to `.env`.

## API (`/hockey/api/*`, alias `/api/*`)

| Route | What |
|---|---|
| `GET /health` | worker heartbeats, counts, paper settings |
| `GET /slate` | games in the window with the latest snapshot summary, edge and bet counts |
| `GET /games/{id}` | full board, every book quote marked to the model, best book per side, edges, bets, closing snapshot |
| `GET /edges?min_ev=` | positive-EV quotes on pregame games |
| `GET /bets`, `GET /bets/summary`, `POST /bets`, `POST /bets/{id}/void` | the paper ledger |
| `GET /results`, `GET /calibration` | finals; reliability buckets, by-family bias/Brier, structural rates vs priors |
| `GET/PUT /params` | model parameters (stored in `settings`, applied next pass) |
| `POST /run/pricing`, `POST /run/settlement` | run a pass now |

Socket.IO at `/hockey/socket.io` (and `/socket.io`) emits `update` after every
worker pass; the frontend refetches on it.

## Layout

| Path | Role |
|---|---|
| `bb_hockey/model/goals.py` | `GameModel`, `ModelParams`, `fit_lambdas`, `prob_for(market, side, point)` |
| `bb_hockey/model/odds_math.py` | American odds, Shin/power/proportional de-vig, EV, Kelly |
| `bb_hockey/odds_reader.py` | every read of `bb_odds` (read-only engine) |
| `bb_hockey/pricer.py` | consensus → inputs → snapshot; `market_check` |
| `bb_hockey/edges.py` | quote → market mapping, EV per side |
| `bb_hockey/paper.py` | auto-paper, manual bets, ledger, P&L |
| `bb_hockey/settlement.py` | ESPN results, grading, closing model, CLV, calibration obs |
| `bb_hockey/calibration.py` | reliability and structural-rate aggregates |
| `bb_hockey/worker.py` | pricing / settlement passes and the asyncio driver |
| `bb_hockey/api/` | FastAPI routes, Socket.IO, SPA host |
| `migrations/` | `bb_hockey` schema (plain SQL, applied in order) |
| `web/` | Vite + React 19 + Tailwind v4 SPA: Board, Edges, Bets, Results, Calibration, Params |

See `CLAUDE.md` for the session entry point, assumptions and what is next.
