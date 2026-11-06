# A moved start time left `current.games` pregame while the books and the consensus went in-play

**From:** BB-Hockey · **Date:** 2026-11-05 · **For:** BB-Odds (schedule ingest / game state / consensus)

**Symptom.** VAN @ WPG (`current.games.id` 1075) was moved by the league to 16:00 PT
(NHL.com `startTimeUTC` 2026-11-06T00:00Z, game 2026020259). BB-Odds's row kept
`game_time` 17:07 PT, `started = false`, `status = 'pregame'` through the first period.
Meanwhile the books switched to in-play pricing and `market_consensus` (413) followed them,
so a "pregame" consensus read WPG −395 and total 8.5 with the Jets up 2–1 in the first:

| time (PT) | consensus h2h (home / away) | what it was |
|---|---|---|
| 15:41 – 16:14 | −200 … −221 / +200 … +221 | pregame |
| 16:15:03 | −362 / +362 | in-play, first books live |
| 16:15:33 | −381 / +381 | |
| 16:20:03 | −395 / +395 | in-play, total 6.5 → 8.5, 1h h2h −1415 |

Per book, first in-play tick on the game h2h: Circa 16:00:47, Pinnacle 16:01:50, Bet105
16:02, BetOnline 16:07, Caesars 16:08, DraftKings 16:08, FanDuel 16:09, Bovada 16:09,
BetMGM 16:09, Sports411 16:09, Polymarket 16:12. The consensus crossed over at 16:15 once
enough of them had moved. Books that had not re-priced (BetOnline −225 at 16:07, Circa −218
at 16:01, ParadiseWager −215 at 15:46, Bet365 −222 from the day before) sat beside −450s.

**Why it matters to us.** BB-Hockey fits its model to the consensus ML + total and marks
every quote against it, gated on your `started` / `completed` flags and `game_time`. With
the game still "pregame" the fit went to the in-play numbers, every leftover pregame quote
became a +10–18% "edge" and 20 paper bets went down in six minutes (voided, flagged
`in_play`). Anything else that treats `current.games.status = 'pregame'` as pregame
(Top Bets, alerts, the edge watcher, BB-Betting) saw the same board.

**What we did on our side (commit 7dca6bd).** Each pricing pass now overlays NHL.com's
schedule (`api-web.nhle.com/v1/schedule/<date>`: `startTimeUTC`, `gameState`) on your
slate rows before pricing, holds a game whose consensus jumps like an in-play market
(> 10 ML points or ≥ 1.5 on the total inside three hours), and flags quotes older than the
consensus's last material move as stale (shown, never papered). So the symptom is contained
here, but the root is upstream.

**Asks, in order of how much they would help:**

1. **Re-read start times until puck drop.** Whatever feeds `current.games.game_time` took the
   original time and never updated it. NHL.com's schedule endpoint is free and carries the
   moved time within minutes; ESPN's scoreboard does too. A refresh of `game_time` for games
   inside the next 24 h on each ETL cycle would have had this one right by the afternoon.
2. **Set `started` from a live source, not the clock.** `started` stayed false for a game in
   its 8th minute. ESPN's `status.type.state = "in"` and NHL.com's `gameState = LIVE` were
   both correct from 16:00. If `started` is derived from `game_time <= now()`, item 1 fixes it;
   if it is a feed flag, it needs a fallback.
3. **Keep in-play ticks out of the pregame consensus.** The books' first in-play ticks
   (Circa 16:00:47, Pinnacle 16:01:50) are distinguishable from pregame moves: a ten-point
   ML move and a two-goal total move in a minute. A consensus that pauses (or marks itself
   `live`) when its inputs move like that, or when any voter's row carries an in-play
   marker, would protect every downstream consumer at once. Your `uses_live_markets_only`
   and `live_enabled` flags suggest the ingest knows which rows are live; the consensus does
   not seem to.
4. **Nominal vs listed start.** NHL.com lists :00 starts; your rows carry :07 (puck drop
   after the TV window). Either is fine, but a `source` or `nominal_start` column would let a
   consumer know which it is reading when reconciling with ESPN or the NHL.

Related: `2026-10-23-donbest-live-stale-twins.md` (the other way stale rows reach the board).

Reply via `BB-Hockey/docs/handoffs/from-bb-odds/`.
