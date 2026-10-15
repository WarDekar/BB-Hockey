from bb_hockey.teams import resolve
from bb_hockey.espn import parse_competition


def test_resolve_spellings():
    assert resolve("TORONTO MAPLE LEAFS").abbr == "TOR"
    assert resolve("NY RANGERS").abbr == "NYR"
    assert resolve("NY ISLANDERS").abbr == "NYI"
    assert resolve("ST. LOUIS BLUES").abbr == "STL"
    assert resolve("ST. LOUIS").abbr == "STL"
    assert resolve("MONTREAL").abbr == "MTL"
    assert resolve("UTAH MAMMOTH").abbr == "UTA"
    assert resolve("Utah").abbr == "UTA"
    assert resolve("LOS ANGELES").abbr == "LA"
    assert resolve("VEGAS GOLDEN KNIGHTS").abbr == "VGK"
    assert resolve("Golden Knights").abbr == "VGK"
    assert resolve("NEW YORK") is None
    assert resolve("BUCKNELL") is None


def _comp(h_lines, a_lines, hs, as_, completed=True):
    return {
        "id": "401892505",
        "status": {"type": {"state": "post" if completed else "in", "completed": completed, "shortDetail": "Final/SO"}},
        "competitors": [
            {"homeAway": "home", "team": {"abbreviation": "COL", "displayName": "Colorado Avalanche"}, "score": str(hs),
             "linescores": [{"value": v} for v in h_lines]},
            {"homeAway": "away", "team": {"abbreviation": "DAL", "displayName": "Dallas Stars"}, "score": str(as_),
             "linescores": [{"value": v} for v in a_lines]},
        ],
    }


def test_parse_shootout_game():
    r = parse_competition(_comp([0, 1, 1, 0, 0], [0, 1, 1, 0, 1], 2, 3))
    assert r["went_ot"] and r["went_so"]
    assert r["reg_home"] == 2 and r["reg_away"] == 2
    assert r["home_score"] == 2 and r["away_score"] == 3
    assert r["periods"] == [[0, 0], [1, 1], [1, 1]]


def test_parse_regulation_game():
    r = parse_competition(_comp([2, 1, 2], [2, 1, 1], 5, 4))
    assert not r["went_ot"] and not r["went_so"]
    assert r["reg_home"] == 5 and r["reg_away"] == 4


def test_parse_ot_game():
    r = parse_competition(_comp([1, 0, 1, 1], [0, 1, 1, 0], 3, 2))
    assert r["went_ot"] and not r["went_so"]
    assert r["reg_home"] == 2 and r["reg_away"] == 2
