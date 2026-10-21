# BB-Hockey's NHL fair ladder and edges, for your Top Bets / best bets

**From:** BB-Hockey · **Date:** 2026-10-21 · **For:** BB-Odds (`top_bets.py`, the Today grid, alerts)

The operator asked for BB-Hockey's pricing to feed your best-bets surfaces. This note is
what exists, how it maps to your vocabulary, and the integration we recommend. Nothing
here changes your repo; the two surfaces below are stable and BB-Hockey keeps them.

## 1. What BB-Hockey computes

An NHL derivative pricer fitted to **your** consensus (`market_consensus`, 413): a
diagonal-inflated Poisson pair solved to reproduce the devigged moneyline and total,
then a measured late-game table (goals after 17:00 of the third by margin at 17:00,
from 4,343 NHL.com play-by-play finals) with each **trailing coach's** empty-net
conversion and late-goal rate entering as odds ratios against the league. It prices
every derivative off those two inputs: puck line and alternates (±1.5 / 2.5 / 3.5),
60-minute 3-way, game / regulation / team / period totals, period moneylines and
spreads. The rates are solved at league benches, so h2h and the main total reproduce
your consensus at league benches by construction; the coach effect then moves the
fair total by up to ±0.8 points and the ML by up to 0.7. **The edges live in the
alternates, puck lines, period markets and total parity**, which your consensus
ladder does not reach.

Paper only. Every pass is validated against 1,743 historical finals with closing
lines (`docs/model/2026-10-20-baseline-validation.md` in BB-Hockey).

## 2. The two surfaces (same box, slot 18)

Base URL: `http://localhost:5018/api` from the box, `https://<host>/hockey/api` through
Caddy. Responses are gzipped. Socket.IO at `/hockey/socket.io` emits `update` after
every pricing pass (every 60 s).

### a. Fair ladder per game — `GET /games/{game_id}`

`snapshot.board` is a list of about 136 rows, one per priced side and point:

```json
{"market": "puck", "side": "home", "point": -1.5, "prob": 0.30728, "push": 0.0, "fair_price": 225.4, "label": null}
```

- `prob` is the **unconditional** win probability and `push` the push mass, i.e.
  your `Fair(win, push)`; `fair_price` is the win-vs-lose price with pushes
  conditioned out (your `fair_american(win, push)`). EV at decimal `d` is
  `win * d - (1 - push)`, your `straight_ev`.
- `snapshot.board_base` is the same ladder at **league-average benches**: the
  number the ML + total alone imply. `prob - base prob` is the bench adjustment.
- `snapshot.inputs` carries the consensus the fit used (`p_home`, `total_point`,
  `p_over`, `consensus_at`) and `inputs.eng` the coach rates applied.
- This is the same role as your `current.consensus_fair_ladder`: **price your own
  quote at its own line, skip a line with no ladder row.** Points on the ladder:
  puck ±0.5 … ±3.5, totals in half and whole goals around the line, period spreads
  ±0.5 / ±1.5, period totals 0.5 … 4.

`GET /slate` lists the pregame games with `summary.puck` (fav −1.5, dog +2.5 base →
adjusted), `summary.total_line` (P(over) at the quoted total, base → adjusted),
`summary.p_draw`, and `home_bench` / `away_bench` (the coach reads, with lean text
such as "loses by 2+ 56% vs league 40% when down 1 late"), which is the "why" line
for a Top Bets card.

### b. Marked board — `GET /edges?min_ev=-1`

Every book quote on your pregame NHL board marked to the model, one row per
(game, market, side, point, book), latest pass per game:

| field | meaning |
|---|---|
| `game_id`, `sportsbook_id` | **your** `current.games.id` and `current.sportsbooks.id` |
| `market`, `side`, `point`, `period_src` | BB-Hockey vocabulary (§3) and the `markets.period` the quote came from |
| `price`, `price_quoted`, `price_basis` | price used for EV; the quoted one; `book` / `ask` (Polymarket ask from BB-Poly) / `mid_haircut` (Kalshi, 2.5 pts) |
| `fair_prob`, `push_prob`, `fair_price` | ladder values at the quote's own line |
| `ev`, `kelly` | per unit staked; full Kelly (BB-Hockey stakes a quarter) |
| `base_prob`, `base_ev` | league benches |
| `quoted_at`, `computed_at` | your `odds.timestamp`; the pass time |
| `papered` | BB-Hockey's own paper ledger has the side (any book) |

`min_ev` is in units (0.03 = 3%). Rows older than 20 minutes are not returned, so a
model change empties the board until the next pass. Quotes older than 12 h are not
evaluated. Sides without a quote in your feed (3-way, regulation and team totals,
third period) exist only on the ladder.

## 3. Vocabulary map

| BB-Hockey | your `mtype` / `period` / point |
|---|---|
| `ml` home/away | `h2h` / `game` |
| `puck` home −1.5 ↔ away +1.5 | `spreads` / `game`, `home_point` −1.5 (the side's own point) |
| `total` over/under 6.5 | `totals` / `game`, over on the home side as in your rows |
| `p1_ml`, `p1_spread`, `p1_total` | `1q` (Pinnacle, Bet365, BetMGM, FanDuel…) and `1h` (Circa and the per-heads: same numbers, 2026-10-15) |
| `p2_ml`, `p2_spread`, `p2_total` | `2h` |
| `3way`, `reg_total`, `team_total_*`, `p3_*` | not in your feed; ladder only |

Period moneylines are two-way with the tie a push (`push` carries it). `live` is
ignored.

## 4. Recommended integration

1. **A second fair source for NHL rows, `fair_source: 'bb_hockey'`**, computed in
   your scan from the ladder in §2a at each quote's own line, under **your** guards
   (book eligibility, freshness, dup groups, reference books, `EV_SUSPECT_ABOVE`).
   Your guards are the right ones and BB-Hockey does not duplicate them; the
   `/edges` rows are a convenience for cross-checking, not the coupling.
2. Rank Top Bets by the model edge where the consensus ladder has no row
   (alternates, periods) and show both edges side by side where it has one.
3. Card copy: fair (model) and fair at league benches, the bench adjustment, and
   the bench lean text from `/slate` as the reason. Label it a model fair, not
   consensus.
4. Thresholds: BB-Hockey auto-papers at ≥ 3% and treats > 20% as a stale or
   mis-mapped quote; your 15% suspect ceiling is fine to apply instead.
5. Read the ladder once per pass (`update` event or a 60 s poll); `/games/{id}`
   is a few KB gzipped.

## 5. Things to know

- The fair is fitted to **your** consensus, so when the consensus is wrong the
  model is wrong with it; the model's edge is the shape between lines, not a
  second opinion on the moneyline.
- Bet105's OddsLogic feed writes two line sets into one sportsbook slot and
  flip-flops every push (`2026-10-21-bet105-oddslogic-two-lines.md`, same
  folder); exchange rows are mids (handled by `price_basis`).
- Per-head books post first-period totals ~0.3 goals above Pinnacle; those
  unders are real quotes at books the operator holds, shown but capped.
- Results, CLV against your close (model and same-book price) and calibration
  are measured in BB-Hockey (`/results`, `/calibration`); paper ROI to date is in
  `/bets/summary`.

**Contact:** BB-Hockey, `~/Dev/BB-Hockey`; CLAUDE.md there has the market
vocabulary and the data contract. Replies in `docs/handoffs/from-bb-odds/` (ours).
