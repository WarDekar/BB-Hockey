import pytest

from bb_hockey.model.goals import GameModel, ModelParams, fit_lambdas, over_prob_conditional
from bb_hockey.model.odds_math import (american_to_prob, devig_two_way, ev_per_unit, kelly_fraction,
                                       prob_to_american, fair_price_no_push)


def test_american_roundtrip():
    for a in (-250, -110, -105, 100, 120, 350):
        p = american_to_prob(a)
        assert abs(american_to_prob(prob_to_american(p)) - p) < 1e-9


def test_devig_methods_sum_to_one_and_order():
    for method in ("shin", "power", "proportional"):
        ph, pa = devig_two_way(-150, 130, method)
        assert abs(ph + pa - 1) < 1e-9
        assert ph > pa
    # Shin loads the hold onto the dog: favourite ends up MORE likely than proportional says.
    ph_shin, _ = devig_two_way(-277, 247, "shin")
    ph_prop, _ = devig_two_way(-277, 247, "proportional")
    assert ph_shin > ph_prop


def test_ev_and_kelly():
    assert abs(ev_per_unit(0.5, 0.0, 100) - 0.0) < 1e-12
    assert ev_per_unit(0.55, 0.0, 100) > 0
    assert kelly_fraction(0.5, 0.0, -110) == 0.0
    assert abs(kelly_fraction(0.6, 0.0, 100) - 0.2) < 1e-12
    # pushes refund: half the mass on push leaves the win/lose odds untouched
    assert abs(fair_price_no_push(0.3, 0.4) - prob_to_american(0.5)) < 1e-9


def test_model_distributions_are_proper():
    m = GameModel(3.1, 2.7)
    assert abs(sum(m.margin_full.values()) - 1) < 1e-9
    assert abs(sum(m.total_full.values()) - 1) < 1e-9
    assert abs(m.p_reg_home + m.p_draw + m.p_reg_away - 1) < 1e-9
    assert abs(m.p_home + m.p_away - 1) < 1e-9
    assert m.margin_full.get(0, 0.0) < 1e-6  # no full-game ties (truncated corner only)
    # Regulation ties sit near the NHL ~23% with default inflation
    assert 0.19 < m.p_draw < 0.27


def test_puck_line_monotone_and_mirrored():
    m = GameModel(3.2, 2.6)
    w15, _ = m.prob_for("puck", "home", -1.5)
    w25, _ = m.prob_for("puck", "home", -2.5)
    assert w25 < w15 < m.p_home
    away_plus, _ = m.prob_for("puck", "away", 1.5)
    assert abs(away_plus + w15 - 1) < 1e-9


def test_total_push_mass_on_integer_lines():
    m = GameModel(3.0, 3.0)
    o, push = m.prob_for("total", "over", 6.0)
    u, push2 = m.prob_for("total", "under", 6.0)
    assert push == push2 > 0.05
    assert abs(o + u + push - 1) < 1e-9


def test_period_markets():
    m = GameModel(3.0, 3.0)
    ph, pd = m.prob_for("p1_ml", "home")
    pa, pd2 = m.prob_for("p1_ml", "away")
    assert pd == pd2 and abs(ph + pa + pd - 1) < 1e-9
    o, p = m.prob_for("p1_total", "over", 1.5)
    assert 0.4 < o < 0.7
    assert m.prob_for("p1_spread", "home", -0.5)[0] == pytest.approx(ph)
    assert m.prob_for("p1_spread", "home", 0.5)[0] == pytest.approx(ph + pd)


def test_fit_reproduces_inputs():
    for p_home, total, p_over in ((0.58, 6.5, 0.52), (0.44, 5.5, 0.47), (0.70, 6.0, 0.55)):
        lh, la, diag = fit_lambdas(p_home, total, p_over)
        m = GameModel(lh, la)
        assert diag["converged"], diag
        assert abs(m.p_home - p_home) < 5e-4
        assert abs(over_prob_conditional(m, total) - p_over) < 5e-4
        assert (lh > la) == (p_home > 0.5)


def test_board_shape():
    rows = GameModel(3.0, 2.8).board()
    keys = {(r["market"], r["side"], r["point"]) for r in rows}
    assert ("puck", "home", -1.5) in keys
    assert ("p1_total", "over", 1.5) in keys
    assert all(0 <= r["prob"] <= 1 for r in rows)
    assert all(r["fair_price"] is None or abs(r["fair_price"]) >= 100 for r in rows)


def test_params_roundtrip():
    p = ModelParams(draw_inflation=1.2, period_shares=(0.3, 0.3, 0.4))
    assert ModelParams.from_dict(p.to_dict()) == p


def test_late_kernel_is_proper_and_coach_sensitive():
    from bb_hockey.model.goals import LATE_KERNEL, GameModel, ModelParams
    for d, cells in LATE_KERNEL.items():
        assert abs(sum(cells.values()) - 1.0) < 0.01, d
    base = GameModel(3.0, 2.6, ModelParams())
    assert abs(base.reg.sum() - 1.0) < 1e-9 and abs(base.full.sum() - 1.0) < 1e-9
    hot = GameModel(3.0, 2.6, ModelParams(), {"home_lead1": 0.60})
    cold = GameModel(3.0, 2.6, ModelParams(), {"home_lead1": 0.30})
    cover = lambda m: m.prob_for("puck", "home", -1.5)[0]  # noqa: E731
    assert cover(cold) < cover(base) < cover(hot)
    assert abs(hot.p_home - base.p_home) < 1e-9  # the empty-netter does not change who wins
    legacy = GameModel(3.0, 2.6, ModelParams(late_kernel=False, draw_inflation=1.45))
    assert abs(legacy.full.sum() - 1.0) < 1e-9
    # Kernel games end with an odd total more often than the Poisson tail says (OT goals + empty-netters).
    odd = lambda m: sum(v for k, v in m.total_full.items() if k % 2)  # noqa: E731
    assert odd(base) > odd(legacy)


def test_kernel_pace_scaling():
    from bb_hockey.model.goals import GameModel, ModelParams, pace_scale
    p = ModelParams(kernel_pace_k=1.0)
    assert pace_scale(3.5, 3.2, p) > 1.0 > pace_scale(2.6, 2.4, p)
    assert pace_scale(3.5, 3.2, ModelParams(kernel_pace_k=0.0)) == 1.0
    fast, slow = GameModel(3.5, 3.2, p), GameModel(3.5, 3.2, ModelParams(kernel_pace_k=0.0))
    assert abs(fast.reg.sum() - 1.0) < 1e-9
    assert fast.summary()["exp_reg_total"] > slow.summary()["exp_reg_total"]  # more late goals at the same rates
