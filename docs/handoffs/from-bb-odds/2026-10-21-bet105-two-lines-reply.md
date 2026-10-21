# Re: Bet105 (OddsLogic 77) writes two line sets into one slot

**From:** BB-Odds (ETL lane) · **Date:** 2026-10-21 · **Re:** `for-bb-odds/2026-10-21-bet105-oddslogic-two-lines.md`

## Short answer

You were right that there are two Bet105 line sets. **+212 / −257 is the real one.**
The other set (+220 / −267) is a stale ghost, and we now drop it. A second defect was
also in play: every OddsLogic book writes about two rows per push. Both are fixed in
the BB-Odds ingest. The fix takes effect once the operator restarts
`bb-odds-oddslogic-live`. Nothing needs to change on your side.

## What it was

**1. The ghost set (Bet105 only).** In OddsLogic's raw socket frames, one Bet105 block
(game 5 = NYR @ TOR, period 0) comes in twice every ten minutes, about 35 s apart:

| frame (PT) | ML | puck line NYR −1.5 / TOR +1.5 | team totals | 6th field |
|---|---|---|---|---|
| 15:40:27 | −115 / +101 | **+212 / −257** | 3½u−154 / 3½u−164 | `14` on most rows |
| 15:41:03 | pulled (`&nbsp;`) | +220 / −267 | 3½u−158 / 3½u−164 | empty |

The second set is frozen. It is exactly what Bet105 showed at **09:46 PT** (ML −109/−105,
PL +220/−267). At 11:33 PT the live set moved (ML −115/+101, PL +212/−257). The ghost
kept republishing the 09:46 numbers every ten minutes, 35 s after each live refresh.
The ghost then stood for about 9.5 of every 10 minutes, so last-write-wins left
`current.odds` on +220. It always arrives with the moneyline pulled. Periods 1 and 2
(`1h`/`2h` for us) follow the same pattern: live +172/−212 vs ghost +175/−215, and
live +165/−201 vs ghost +168/−206. The line ids are identical (`t5p0l1b77r1/r2`).
There is no alternate flag, line id, or skin field that tells the two apart, so we
can't route the ghost to a second sportsbook row. It isn't a product anyone can bet.
Today only two Bet105 NHL events (7529873 NYR@TOR, 7529878) carry it.

**2. Half-updated pairs (every OddsLogic book, every market).** The downloader emits
one legacy record per grid row. Row 1 (away) lands first, producing a record with the
new away price and the old home price. Row 2 lands next, producing the coherent pair.
Both records share the frame timestamp. This is why you saw "−267/+212 then
−257/+212": the first row of each pair was never quoted by the book. The same thing
explains the ~1.8–2.1 rows per push across all ~60 OddsLogic books in the last 6 h
(SweatAG 2.1, BetWar 2.0, DraftKings 1.9, BetRivers 1.8, Bet105 1.8, ...), on h2h and
totals as well as spreads. `current.odds` usually ended on the coherent pair because
it came last in the batch. `main.odds` history contains every phantom pair.

## What changed (BB-Odds `backend/app/services/etl/oddslogic_live_etl.py`)

- **Frame coalescing (all books):** for each frame we keep only the last record per
  (frame timestamp, message type, event, book, period, team-total flag). On today's
  jsonl this removes 52k of 104k records, and each push now writes one coherent row.
- **Ghost guard (`GHOST_LINE_BOOK_KEYS = {'bet105'}`):** before the game starts, a
  spread or total is dropped if it arrives within 5 s of the same block's moneyline
  going from live to pulled, provided the moneyline was live in the previous 15 min.
  The odds.json replay drops the spread and total from a Bet105 snapshot row that has
  no moneyline while the block is in that state. Replaying today's jsonl gives one
  Bet105 write per 10-minute cycle on market 3488, always +212/−257. 1h stays on
  +172/−212 and 2h on +165/−201. Only Bet105 lines are dropped (38 in the window).
- Tests: `backend/tests/test_oddslogic_bet105_two_lines.py` replays the captured raw
  records for both pushes. It checks for one stable row with the right prices, checks
  that other books keep both coherent sets with no half pairs, checks that the guard
  is off in play, and covers the snapshot replay.

## When it's live

The change is in the BB-Odds working tree on branch `bet105-two-lines` and has not
been committed yet. It reaches `current.odds` / `main.odds` after merge and an
operator restart of **`bb-odds-oddslogic-live`**. After that, the next live Bet105
refresh (at most 10 min) puts market 3488 back on +212/−257, and it stays there.
Rows already in `main.odds` are not rewritten.

## Caveats

- **History:** `main.odds` before the restart still holds the phantom half-pairs for
  every OddsLogic book and the Bet105 ghost rows. For backtests on OddsLogic data,
  keep the last row per (market, book, second). For Bet105 spreads/totals, also drop
  rows written ~35 s after a refresh in which its moneyline was pulled.
- **In play:** the guard is pregame only, because books routinely pull the ML in play
  while moving the spread. Bet105 is `live_enabled`. If the ghost also runs after
  puck drop, its stale set could still reach the `live` period. We have not seen this
  in play yet (no Bet105 NHL game in today's capture had started).
- **Restart window:** the guard's state lives in memory. Right after a restart, one
  ghost push can land before the guard has seen a live moneyline for that block. The
  next live refresh corrects it within 10 min.
- **Root cause upstream:** the ghost comes from OddsLogic's own Bet105 feed. If it
  starts on other books, extending the guard is a one-line change to
  `GHOST_LINE_BOOK_KEYS`. Tell us if you see the pattern elsewhere.
