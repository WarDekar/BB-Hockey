# Bet105 (OddsLogic 77) writes two line sets into one sportsbook slot and flip-flops every push

**From:** BB-Hockey · **Date:** 2026-10-21 · **For:** BB-Odds (OddsLogic ingest)

**Symptom.** The operator saw +212 on Bet105's site for NYR −1.5 (NYR @ TOR, 2026-10-22,
`current.markets.game_id` 230) while `current.odds` said +220 with a fresh timestamp.
The row is not stale: it alternates.

**What `main.odds` shows for sportsbook 716 (Bet105, `source` oddslogic, `oddslogic_sportsbook_id` 77),
market 3488 (spreads, game, home point +1.5), today:**

| push (PT) | rows written in that second (home/away) |
|---|---|
| 15:31:04 | −257/+220, −267/+220 |
| 15:30:28 | −267/+212, −257/+212 |
| 15:21:00 | −257/+220, −267/+220 |
| 15:20:24 | −267/+212, −257/+212 |
| 15:10:58 | −257/+220, −267/+220 |
| 15:10:22 | −267/+212, −257/+212 |

Every ten minutes two pushes land about 35 s apart; each writes **two rows** for the same
(market, sportsbook), with two different home prices, and the away price alternates
+212 / +220 between the two pushes. 108 rows in four hours against 35 for BetRivers and
12 for 4caster on the same market. Same 1.9 rows-per-push pattern on Bet105's `1h` and
`2h` spreads; `h2h` and `totals` are single rows. The pairs are not each other's vig
mirror (−267/+220 is 2.6% hold, −257/+212 is 3.0%), so this looks like two Bet105 line
sets in the OddsLogic payload (two skins, or standard vs reduced-juice, or two line ids)
keyed to one `sportsbook_id`, with last-write-wins deciding what `current.odds` says.

**Why it matters downstream.** BB-Hockey marks every book quote to its model; the +220
rows read as +3.1% EV against a +210 fair while the +212 rows read as +0.5%, so the edge
appears and disappears every five minutes, and the auto-paper ledger can bet a price
the site is not showing. Any consumer of `current.odds` for Bet105 spreads has the same
problem.

**Ask.** Whichever of the two is the Bet105 line the operator's account sees, keep that
one; the other belongs under its own sportsbook row (or a `dup_group`), or should be
dropped. If OddsLogic's payload carries a line id or skin field, it is probably the key.
No change is needed on the BB-Hockey side once `current.odds` holds one line per book.

Questions back via `docs/handoffs/from-bb-odds/`.
