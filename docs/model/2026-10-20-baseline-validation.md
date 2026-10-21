# Baseline puck lines from ML + total: validation against historical finals

**Date:** 2026-10-20 · **Data:** 1,743 NHL finals with closing moneyline, puck-line
price and total (sportsbookreviewsonline archive: all of 2021-22, plus 2022-23
through Nov 27 2022; later seasons are not published there). Closing prices were
Shin-devigged exactly as BB-Odds's consensus is, then fed to the model as the
pregame inputs, and the model's fair cover probabilities (pushes conditioned out)
were averaged and compared with what happened.

The question: given only a moneyline and a total, what should the puck line and
the alternates cost? The answer is the **baseline** every snapshot now carries
(`board_base`). The coach adjustment sits on top of it.

## Overall

| Market | Realised | Old prior (ENG 0.28, no 2→3) | Final model | Market close |
|---|---:|---:|---:|---:|
| Favourite −1.5 | 41.4% | 37.8% | **39.9%** | 40.4% |
| Favourite −2.5 | 29.0% | 20.7% | **26.9%** | — |
| Favourite −3.5 | 12.4% | 11.4% | 12.3% | — |
| Underdog +2.5 | 71.0% | 79.3% | **73.1%** | — |
| Underdog wins by 2+ | 19.4% | — | 22.6% | — |
| Any margin of 2+ | 60.8% | — | 62.5% | — |
| Regulation tie | 21.5% | 21.6% | 21.6% | — |
| Mean total | 6.30 | 6.21 | 6.21 | — |

The old prior under-priced the favourite −1.5 by 3.6 points and the −2.5 by 8
points, and over-priced the underdog +2.5 by 8 points. That is the whole
alternate-line market.

**Why the favourite side still reads 1.5 points short and the underdog side
3 points long.** Favourites won 63.7% of these games against 61.1% priced
(2.3 standard errors), so every "favourite by" rate is lifted and every
"underdog by" rate is depressed relative to what the closing line implied.
Conditional on who won, the model's shape is right for favourites (65.3%
of favourite wins were by two or more, modelled 65.3%) and about 4 points
wide for underdogs (53.4% realised, 58.1% modelled). A symmetric strength
mixture (`strength_sigma` 0.35) was tried: it matched the favourite side
by widening both, pushing any-2+ to 64.9% against 60.8% real, and was
rejected. A leader-strength multiplier on the empty-net rate was also
tried in several forms; all over-shot heavy favourites, which cover −1.5
*less* (49%) than any form predicts. The shape stays symmetric and the
residual is logged, not fitted.

## What changed in the model

1. **Empty-net rate for one-goal leads** 0.28 → **0.44**, measured with the
   model's own definition from NHL.com play-by-play (of teams down one inside
   3:00 that lost, 44% lost by two or more).
2. **Two-goal leads → three** (new), **0.42**.
3. **Second empty-netter** (new), **0.18** of the first: pull, concede, pull
   again. Moves margin-2 mass to margin 3; this is why real NHL games end by
   three more often (23%) than by two (20%).
4. **Three-goal leads → four** (new), **0.14**.
5. Per game, 1 and 2 use the trailing side's coach's own conversion, shrunk
   toward the league with a 40-situation weight.

## By price band (favourite's devigged ML probability)

| Band | n | Fav won (real / ML) | Fav by 2+ real / model / market | Dog by 2+ real / model |
|---|---:|---|---|---|
| 0.50–0.56 | 548 | 55.8% / 53.1% | 36.3% / 32.8% / 35.4% | 24.5% / 28.1% |
| 0.56–0.62 | 501 | 60.9% / 59.1% | 38.7% / 37.8% / 36.7% | 21.6% / 23.7% |
| 0.62–0.68 | 354 | 72.6% / 64.8% | 45.2% / 43.0% / 42.3% | 12.1% / 19.9% |
| 0.68–0.80 | 324 | 71.9% / 72.4% | 49.4% / 50.7% / 51.2% | 15.4% / 15.2% |

Standard error per band is 2–3 points, and the 0.62–0.68 band's favourites won
8 points more often than their price in this sample, which lifts every realised
cover rate there and halves the underdog's. Read the bands as direction.

## Residuals worth knowing when targeting

- **Near coin-flips (≤ 56%)**: any-2+ margin is right (60.9% modelled, 60.8%
  real) but split 33/28 by the model against 36/24 real, i.e. the side the
  market calls the favourite blows out more than the model says and the dog
  less. If that is favourite-longshot bias in the moneyline rather than
  noise, the fix belongs in the ML input, not the margin shape.
- **Heavy favourites (≥ 68%)**: the model is 1 point generous on the −1.5
  and 2 points harsh on the dog +2.5; treat big-favourite puck-line edges
  with suspicion.
- **Totals shape** (fixed 2026-10-21, see below): the quoted-total
  probability is fitted, so it is right by construction, but the
  distribution under it was not: with the Poisson tail running to the
  horn, exactly six goals in games lined at 6.0 happened 9.4% of the time
  against 11.7% modelled and sevens came 18.7% against 21.1%. The late-game
  kernel brings these to 11.1% and 19.5%.
- **Exchange quotes**: BB-Odds stores Polymarket and Kalshi at the bid/ask
  mid. The pricer now reads the Polymarket ask from BB-Poly (about 0.6
  points inside the mid on spreads and moneylines, 2.8 on totals) and
  applies a 2.5-point haircut to Kalshi; the Edges tab shows which basis
  a price is on. Before this, a +257 mid on a −1.5 read as +14% EV against
  a fair of +212; at the ask against the corrected fair of +226 it is about
  +7%, and at Pinnacle's +233 about +2%.

## The late-game kernel (2026-10-21)

The Poisson pair now runs to 17:00 of the third (`LATE_CUT_S` = 180) and the
last three minutes come from a measured transition: for each goal margin at
17:00 (0, 1, 2, 3, 4+), the distribution of (leader adds, trailer adds)
regulation goals from there, read off 4,343 NHL.com play-by-play finals
2023-24 to date (`python -m bb_hockey.pbp kernel`, `goals.LATE_KERNEL`).
Ties after 60 resolve as before. The empty-net mass shifts (`eng_rate`,
`eng_rate2`, `eng_chain`, `eng_rate3`) are no longer applied under the
kernel: the kernel carries the empty-netters, the tying goals with the net
empty and the chains itself. The coach rates still matter: the trailing
coach's conversion relative to the league reference moves the kernel's
"leader adds one" branch by the same odds ratio, so a bench that concedes
60% against the league's 44% lifts the favourite −1.5 from 35.5% to 37.6%
on a typical line, and a 30% bench cuts it to 33.5%. `draw_inflation` now
applies at 17:00 and drops from 1.45 to 1.20 (about 20% tied at 17:00
against 19.3% in the play-by-play; 21.7% tied after 60 against 21.5% in
the validation sample). `ot_decided_share` is 0.68 (904 OT games, 290
shootouts).

What the kernel says (mean regulation goals after 17:00 by margin at
17:00): tied 0.25, down one 0.76, down two 0.92, down three 0.46, down
four or more 0.21. Down one: 37% nothing, 34% the empty-netter, 17% the
tying goal, 8% two empty-netters. Down two: 51% one empty-netter, 25%
nothing, 10% the trailer pulls one back, 6% one each.

Same 1,743 finals, old path against the kernel:

| Quantity | Realised | Poisson tail + shifts | Late kernel |
|---|---:|---:|---:|
| Favourite −1.5 | 41.4% | 39.9% | 39.3% |
| Favourite −2.5 | 29.0% | 26.9% | 28.1% |
| Favourite −3.5 | 12.4% | 12.3% | 12.5% |
| Underdog +2.5 | 71.0% | 73.1% | 71.9% |
| Underdog wins by 2+ | 19.4% | 22.6% | 22.4% |
| Any margin of 2+ | 60.8% | 62.5% | 61.7% |
| Regulation tie | 21.5% | 22.0% | 21.7% |
| Odd total | 67.5% | 65.6% | 67.9% |
| Exactly 6 at a 6.0 line (n 629) | 9.4% | 11.7% | 11.1% |
| Exactly 7 goals | 21.1% | 18.7% | 19.5% |
| Exactly 3 goals | 9.2% | 10.7% | 11.1% |
| Under 6 at a 6.5 line (n 528) | 37.5% | 38.3% | 38.9% |
| Over 7 at a 6.5 line | 31.1% | 30.7% | 29.9% |

The alternates and the parity of the total move toward the data; the
favourite −1.5 gives back 0.6 points (the kernel's down-one empty-net share
at 17:00 is the league's, and the favourite-won-more residual above is
unchanged). The one residual that got slightly worse is the low tail:
three-goal games are 2 points over-produced, which is the Poisson's shape
under a 5.5 line rather than anything late. The kernel is the same for
every game; late scoring in high-total games is not scaled up, and the
tails at 6.5 lines read about a point thin. Both are logged, not fitted.

`late_kernel = 0` in Params restores the old path (set `draw_inflation`
back to 1.45 with it).

## How to target with this

The Edges tab shows, per quote, the fair probability, the **baseline** (league
benches, same ML and total), the **bench adjustment** (fair minus baseline), the
EV and the baseline EV, with chips to filter:

- **Bench-driven**: above threshold only after the coach adjustment. These are
  the opportunities the market structurally cannot price (it does not know who
  pulls at 2:25 and who sits at 1:35).
- **At baseline too**: the ML and total alone already imply the edge; the
  book's puck line is simply off its own moneyline. Real, but shared with
  everyone who runs a Poisson.
- **Adjustment against**: the benches cut into the edge; the baseline flatters
  it.

The Board shows the favourite −1.5 and the underdog +2.5 as baseline → adjusted
per game, and the game page has a Base column on every ladder.

## Reproducing

`scratchpad/sbr_games.py` parses the archive pages (run with `-I`, they are
untrusted HTML) into `sbr_games.json`; the validation script in this session's
history fits every game under each parameter set and averages the fair
probabilities. Re-run when another season's closing lines become available;
the archive is the only free multi-season source found, BB-Odds's own history
holds 57 NHL games.
