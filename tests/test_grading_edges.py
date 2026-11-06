from bb_hockey.settlement import grade
from bb_hockey.edges import market_key, evaluate_quotes, best_per_side
from bb_hockey.model.goals import GameModel

SO = {"final_home": 2, "final_away": 3, "reg_home": 2, "reg_away": 2, "periods": [[0, 0], [1, 1], [1, 1]], "went_ot": True, "went_so": True}
REG = {"final_home": 5, "final_away": 2, "reg_home": 5, "reg_away": 2, "periods": [[2, 0], [1, 1], [2, 1]], "went_ot": False, "went_so": False}


def test_grade_full_game():
    assert grade("ml", "home", None, SO) == "lost"
    assert grade("ml", "away", None, SO) == "won"
    assert grade("3way", "draw", None, SO) == "won"
    assert grade("puck", "home", 1.5, SO) == "won"       # lost by 1 in SO, +1.5 covers
    assert grade("puck", "away", -1.5, SO) == "lost"
    assert grade("puck", "home", -1.5, REG) == "won"
    assert grade("puck", "home", -3.0, REG) == "push"
    assert grade("total", "over", 4.5, SO) == "won"      # 5 incl. the SO goal
    assert grade("total", "over", 5.0, SO) == "push"
    assert grade("reg_total", "under", 4.5, SO) == "won"
    assert grade("team_total_away", "over", 2.5, SO) == "won"
    assert grade("team_total_home", "over", 2.5, SO) == "lost"


def test_grade_periods():
    assert grade("p1_ml", "home", None, SO) == "push"
    assert grade("p1_3way", "draw", None, SO) == "won"
    assert grade("p1_spread", "home", 0.5, SO) == "won"
    assert grade("p1_spread", "home", -0.5, SO) == "lost"
    assert grade("p1_total", "under", 0.5, SO) == "won"
    assert grade("p3_total", "over", 2.5, REG) == "won"
    assert grade("p3_ml", "home", None, REG) == "won"
    assert grade("p2_total", "over", 2.0, REG) == "push"


def test_market_key_mapping():
    assert market_key("spreads", "game") == "puck"
    assert market_key("totals", "1q") == "p1_total"
    assert market_key("h2h", "1h") == "p1_ml"
    assert market_key("totals", "2h") == "p2_total"
    assert market_key("totals", "live") is None


def test_evaluate_quotes_sides_and_best():
    m = GameModel(3.2, 2.6)
    quotes = [
        {"game_id": 1, "market_type": "spreads", "period": "game", "sportsbook_id": 1, "book": "A", "book_group": None,
         "home_price": 200, "away_price": -240, "home_point": -1.5, "away_point": 1.5, "timestamp": None},
        {"game_id": 1, "market_type": "spreads", "period": "game", "sportsbook_id": 2, "book": "B", "book_group": None,
         "home_price": 230, "away_price": -270, "home_point": -1.5, "away_point": 1.5, "timestamp": None},
        {"game_id": 1, "market_type": "totals", "period": "1q", "sportsbook_id": 1, "book": "A", "book_group": None,
         "home_price": -110, "away_price": -110, "home_point": 1.5, "away_point": 1.5, "timestamp": None},
    ]
    rows = evaluate_quotes(m, quotes)
    assert len(rows) == 6
    best = best_per_side(rows)
    assert best[("puck", "home", -1.5)]["sportsbook"] == "B"   # +230 beats +200 at the same fair prob
    over = next(r for r in rows if r["market"] == "p1_total" and r["side"] == "over")
    assert over["point"] == 1.5 and 0 < over["fair_prob"] < 1


def test_auto_paper_exclude_falls_to_next_book(monkeypatch):
    from bb_hockey import paper
    from bb_hockey.config import settings
    monkeypatch.setattr(settings, "auto_paper_exclude", ("Bet105:puck",))
    rows = [{"market": "puck", "side": "away", "point": -1.5, "sportsbook": "Bet105", "ev": 0.08},
            {"market": "puck", "side": "away", "point": -1.5, "sportsbook": "Pinnacle", "ev": 0.04},
            {"market": "total", "side": "over", "point": 6.0, "sportsbook": "Bet105", "ev": 0.05}]
    kept = [r for r in rows if not paper.auto_excluded(r)]
    best = best_per_side(kept)
    assert best[("puck", "away", -1.5)]["sportsbook"] == "Pinnacle"      # Bet105's spread is skipped, not the side
    assert best[("total", "over", 6.0)]["sportsbook"] == "Bet105"        # its totals are fine


def test_board_delta_only_moved_rows():
    from bb_hockey.board import compute_delta, _with_keys
    a = {"game_id": 1, "period_src": "game", "market": "puck", "side": "home", "point": -1.5, "sportsbook_id": 7, "ev": 0.04, "price": 150, "id": 10, "computed_at": "t1"}
    b = {"game_id": 1, "period_src": "game", "market": "puck", "side": "home", "point": -1.5, "sportsbook_id": 8, "ev": 0.02, "price": 140, "id": 11, "computed_at": "t1"}
    g = {"id": 1, "home_name": "X", "updated_at": "t1", "n_edges": 2}
    d0, e_sig, s_sig = compute_delta({}, {}, _with_keys([a, b]), [g])
    assert len(d0["edges_upsert"]) == 2 and d0["slate_upsert"] == [g]
    # next pass: same content, new table ids and timestamps → nothing moved
    a2, b2 = dict(a, id=20, computed_at="t2"), dict(b, id=21, computed_at="t2")
    d1, e_sig, s_sig = compute_delta(e_sig, s_sig, _with_keys([a2, b2]), [dict(g, updated_at="t2")])
    assert not any(d1.values())
    # a price moves, a book drops, the game's edge count changes
    a3 = dict(a2, price=155, ev=0.05)
    d2, _, _ = compute_delta(e_sig, s_sig, _with_keys([a3]), [dict(g, n_edges=1)])
    assert [r["price"] for r in d2["edges_upsert"]] == [155] and d2["edges_delete"] == [_with_keys([b])[0]["key"]]
    assert d2["slate_upsert"][0]["n_edges"] == 1 and d2["slate_delete"] == []


def test_board_keys_split_duplicate_quotes():
    from bb_hockey.board import _with_keys
    r = {"game_id": 1, "period_src": "game", "market": "puck", "side": "away", "point": 1.5, "sportsbook_id": 716}
    keys = [x["key"] for x in _with_keys([dict(r, price=212), dict(r, price=220)])]
    assert len(set(keys)) == 2 and keys[0].endswith("|0") and keys[1].endswith("|1")


def test_jump_guard_holds_in_play_moves():
    from datetime import datetime, timedelta, timezone
    from bb_hockey.pricer import jumped
    now = datetime(2026, 11, 6, 0, 15, tzinfo=timezone.utc)
    prev = {"computed_at": now - timedelta(minutes=2), "inputs": {"p_home": 0.68, "total_point": 6.5}}
    assert jumped(prev, {"p_home": 0.79, "total_point": 6.5}, now)            # −200 → −450
    assert jumped(prev, {"p_home": 0.69, "total_point": 8.5}, now)            # 6.5 → 8.5
    assert jumped(prev, {"p_home": 0.72, "total_point": 7.0}, now) is None    # goalie news
    old = dict(prev, computed_at=now - timedelta(hours=5))
    assert jumped(old, {"p_home": 0.79, "total_point": 8.5}, now) is None     # not the same market any more
    assert jumped(None, {"p_home": 0.79, "total_point": 8.5}, now) is None


def test_schedule_overlay_uses_nhl_start_and_state():
    from datetime import datetime, timedelta, timezone
    from bb_hockey.schedule import overlay
    now = datetime(2026, 11, 6, 0, 20, tzinfo=timezone.utc)
    bb = {"id": 1075, "game_time": datetime(2026, 11, 6, 1, 7, tzinfo=timezone.utc), "started": False, "completed": False}
    idx = {("VAN", "WPG"): {"start": datetime(2026, 11, 6, 0, 0, tzinfo=timezone.utc), "state": "LIVE", "id": 2026020259}}
    g = overlay(bb, idx, "VAN", "WPG", now)
    assert g["started"] and g["game_time"] == idx[("VAN", "WPG")]["start"] and g["nhl_game_id"] == 2026020259
    # no NHL row: BB-Odds's time stands, but a game past its start is started regardless
    g2 = overlay(dict(bb, game_time=now - timedelta(minutes=1)), {}, "ANA", "EDM", now)
    assert g2["started"]
    g3 = overlay(dict(bb, game_time=now + timedelta(hours=1)), {}, "ANA", "EDM", now)
    assert not g3["started"]


def test_stale_quotes_are_flagged_and_not_papered():
    from datetime import datetime, timedelta, timezone
    from bb_hockey.paper import auto_excluded
    moved = datetime(2026, 11, 6, 0, 14, tzinfo=timezone.utc)
    q = {"game_id": 1, "market_type": "spreads", "period": "game", "sportsbook_id": 713, "book": "BetOnline",
         "home_price": -105, "away_price": -115, "home_point": -1.5, "away_point": 1.5, "timestamp": moved - timedelta(minutes=7)}
    from bb_hockey.model.goals import GameModel, ModelParams
    m = GameModel(3.4, 2.4, ModelParams())
    rows = evaluate_quotes(m, [q], moved_at=moved)
    assert rows and all(r["stale"] for r in rows) and all(auto_excluded(r) for r in rows)
    fresh = evaluate_quotes(m, [dict(q, timestamp=moved + timedelta(seconds=30))], moved_at=moved)
    assert not any(r["stale"] for r in fresh)
