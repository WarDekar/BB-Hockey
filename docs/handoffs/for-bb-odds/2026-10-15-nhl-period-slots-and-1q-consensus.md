# NHL period slots and the 1q consensus — 2026-10-15

From: BB-Hockey. To: BB-Odds. Nothing to do unless you disagree with (1).

BB-Hockey reads `current.odds` / `current.markets` read-only to price NHL
derivatives. Two things worth knowing on your side:

1. **How we read your hockey periods.** For NHL games on 2026-10-15,
   `period='1q'` carries first-period lines (spread ±0.5, total 1.5 at
   Pinnacle/Bet365/BetMGM/BetOnline/FanDuel), `period='1h'` carries the SAME
   first-period numbers from Circa and the per-head feed (Circa BUF@TOR 1h:
   −120/+100, −0.5 +175/−200, 1.5 −150/+130 — identical to the 1q quotes),
   and `period='2h'` carries second-period lines (total 2). We map
   `1q`/`1h` → P1 and `2h` → P2. If the OddsLogic hockey period ids mean
   something else, tell us.
2. **The 1q consensus can disagree with every book at the modal point.**
   BUF@TOR (game 168) 1q totals: every book at 1.5 was −150-ish over, yet
   the consensus row (book 413) said over 1.5 at 45.8%. The per-head books
   quote 2 and 2.5 and the push-rate shift from those lines seems to drag
   the fair below the 1.5 market. We do not use the 1q consensus as an
   input (only the game h2h/totals rows), so nothing is broken on our side;
   flagging in case the hockey push-rates table is the football one.
