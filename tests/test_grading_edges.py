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
