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
| Favourite −1.5 | 41.4% | 37.8% | **41.3%** | 40.4% |
| Favourite −2.5 | 29.0% | 20.7% | **28.9%** | — |
| Favourite −3.5 | 12.4% | 11.4% | 14.6% | — |
| Underdog +2.5 | 71.0% | 79.3% | **71.1%** | — |
| Regulation tie | 21.5% | 21.6% | 20.5% | — |
| Mean total | 6.30 | 6.21 | 6.21 | — |

The old prior under-priced the favourite −1.5 by 3.6 points and the −2.5 by 8
points, and over-priced the underdog +2.5 by 8 points. That is the whole
alternate-line market.

## What changed in the model

1. **Empty-net rate for one-goal leads** 0.28 → **0.44**, measured with the
   model's own definition from NHL.com play-by-play (of teams down one inside
   3:00 that lost, 44% lost by two or more).
2. **Two-goal leads → three** (new), **0.42**.
3. **Second empty-netter** (new), **0.18** of the first: pull, concede, pull
   again. Moves margin-2 mass to margin 3; this is why real NHL games end by
   three more often (23%) than by two (20%).
4. **Three-goal leads → four** (new), **0.14**.
5. **Strength uncertainty** (new), σ = **0.35** on the log rate-ratio, a
   five-point Gauss-Hermite mixture. Widens margins without touching the
   total. Without it the model's margins spread with the price more steeply
   than reality's.
6. Per game, 1 and 2 use the trailing side's coach's own conversion, shrunk
   toward the league with a 40-situation weight.

## By price band (favourite's devigged ML probability)

| Band | n | Fav won (real / ML) | Fav −1.5 real / model / market | Dog +2.5 real / model |
|---|---:|---|---|---|
| 0.50–0.56 | 548 | 55.8% / 53.1% | 36.3% / 34.1% / 35.4% | 75.2% / 77.4% |
| 0.56–0.62 | 501 | 60.9% / 59.1% | 38.7% / 39.2% / 36.7% | 72.7% / 73.1% |
| 0.62–0.68 | 354 | 72.6% / 64.8% | 45.2% / 44.4% / 42.3% | 67.8% / 68.5% |
| 0.68–0.80 | 324 | 71.9% / 72.4% | 49.4% / 52.2% / 51.2% | 66.0% / 61.1% |

Standard error per band is 2–3 points, and the 0.62–0.68 band's favourites won
8 points more often than their price in this sample, which lifts every realised
cover rate there. Read the bands as direction, not as fitted numbers.

## Residuals worth knowing when targeting

- **Heavy favourites (≥ 68%)**: the model is 3 points generous to the
  favourite −1.5 and 5 points harsh on the dog +2.5. Until more seasons say
  otherwise, treat a model edge on a big favourite's −1.5 / −2.5 with
  suspicion and a dog +2.5 as better than modelled.
- **Near coin-flips (≤ 56%)**: the model is 2 points short on the −1.5. The
  market is also short (35.4% vs 36.3% real), so the edge is smaller than it
  looks but points the same way.
- **−3.5**: 2 points generous after the mixture; `eng_rate3` or σ could come
  down a notch when more data arrives.
- **Totals shape**: the quoted-total probability is fitted, so it is right by
  construction, but the distribution under it is not: real totals spike on
  odd numbers (5: 22.0%, 7: 21.1%) and dip on 6 (10.7%); the model gives 20.7 /
  18.4 / 11.9. So alternate totals around a 6 (the 5.5 and 6.5, and the push
  at 6) are mispriced by roughly a point each. The fix is a late-game goal
  kernel from the play-by-play (`pull_situations.late_goals`), which we have:
  goals added after 17:00 by state, rather than a Poisson tail. Next step.
- **Regulation ties** dropped a point with the mixture (20.5% vs 21.5%);
  `draw_inflation` 1.45 → ~1.52 would restore it, to be confirmed on the
  Calibration tab's 3-way family rather than tuned blind.

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
