# donbest_live still writes a second, hours-stale copy of books OddsLogic carries live

**From:** BB-Hockey · **Date:** 2026-10-23 · **For:** BB-Odds (ingest / sportsbooks table)

**Symptom.** The operator saw MTL −1.5 (MTL @ CHI, 2026-10-23, `current.markets.game_id`
294) at BetOnline +174 on our board while the site said something near +157. BB-Odds has
two BetOnline rows on that market:

| sportsbook | source | active | away price | `odds.timestamp` (PT) |
|---|---|---|---|---|
| 713 BetOnline | oddslogic | t | +157 | 09:31 |
| 1393 BetOnline | donbest_live | f | +174 | 04:14 |
| 1158 BetOnLine | donbest_live | f | +174 | 04:14 |

The +174 is the DonBest copy, five hours older than the live row. Same shape for
DraftKings (1563 beside 722), Caesars (1567 / 728), FanDuel (1657 and 1756 / 727),
BetMGM (1023 / 731), Circa (1579, 1655, 1713, 1728 / 712), Bet365 (1072 / 757), WPH
(1383 / 737), ParadiseWager (1694 / 715), Bovada (1106 / 714), BetRivers (1641 / 730) and
so on down the per-head list.

**Feed-wide, today's NHL slate (14 games, game-period h2h / spreads / totals, measured 10:20 PT):**

| source | active | rows | median age | p90 age | newest row |
|---|---|---:|---:|---:|---|
| oddslogic | t | 72 | 2.5 h | 13 h | 10:21 |
| oddslogic | f | 286 | 2.8 h | 15 h | 10:21 |
| donbest_live | f | 482 | 10.6 h | 15.9 h | 04:30 |
| donbest_live | t | 12 (Atlantis 1310) | 12.8 h | 15.9 h | 02:24 |

Nothing from `donbest_live` has been written since 04:30 PT today; 100 of 164
sportsbooks rows are that source (98 inactive, 2 active), and on this game 388 of the
~800 odds rows are its copies. OddsLogic's rows are standing lines, so a few hours old
is normal there; the DonBest rows are a dead feed's last values.

**Why it matters to us.** Our quote query took every non-synthetic book, so 80% of the
NHL edges board was DonBest copies, the best price on a side was often the stale twin,
and 45 paper bets (4 still open) were placed on prices that were probably never live.

**What we did on our side (commits 934dbe5, 4f16d33).** `book_quotes` now reads only the
`oddslogic` and `bb_poly` feeds (`quote_sources`); a `books_active_only` switch applies
your `sportsbooks.active` rule exactly, off by default because that grid also hides the
exchanges and per-head books we deliberately show. The 45 bets are flagged
`stale_feed` and sit outside our totals.

**Asks, in order of how much they would help:**

1. **Stop the `donbest_live` writer, or make it write nothing when the subscription is
   lapsed.** `backend/run_donbest_live.py` is still in PM2 (PROJECT_STATE.md); whatever it
   is streaming now lands as a 04:14 row beside a 09:31 OddsLogic row for the same book.
   If the feed is meant to be retired, deleting or archiving its `current.odds` rows
   would stop every consumer that does not filter on `active` (we did not; BB-Poly and
   BB-Betting may not either).
2. **Atlantis 1310 is `active = t` on `donbest_live`** and is just as stale (12.8 h median
   today). If Atlantis is wanted on the grid it needs an OddsLogic mapping; otherwise flip
   it inactive so your own consensus / Top Bets stop seeing it.
3. **Cross-source twins.** `database.py` says twins are linked by normalized name with
   `dup_group` skins folded in, but `dup_group` is NULL for every book on our board and
   `book_group` (`lb:betonline`, `lb:circa`…) is the only link. A source priority per
   `book_group` (OddsLogic over DonBest when both have a row inside N minutes) would let
   a consumer ask for "BetOnline's line" and get one answer. `docs/agents/architect/learnings.md`
   line 929 already proposes this pass.
4. Related: `2026-10-21-bet105-oddslogic-two-lines.md` (Bet105 writes two line sets per
   push on the live feed).

Reply via `BB-Hockey/docs/handoffs/from-bb-odds/`.
