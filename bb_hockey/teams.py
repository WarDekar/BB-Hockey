"""The 32 NHL clubs: BB-Odds spelling, ESPN abbreviation, aliases.

BB-Odds's NHL team rows carry the full name ("TORONTO MAPLE LEAFS") since
the 2026-10-13 DonBest schedule import, with a legacy generation of city
rows ("NY RANGERS", "MONTREAL") still in the league (BB-Poly's
``test_nhl_discovery.py`` documents both). Resolve either to one record.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class Team:
    abbr: str        # ESPN abbreviation
    city: str
    nickname: str
    aliases: tuple = ()

    @property
    def full(self) -> str:
        return f"{self.city} {self.nickname}".upper()


TEAMS = [
    Team("ANA", "Anaheim", "Ducks"),
    Team("BOS", "Boston", "Bruins"),
    Team("BUF", "Buffalo", "Sabres"),
    Team("CGY", "Calgary", "Flames"),
    Team("CAR", "Carolina", "Hurricanes"),
    Team("CHI", "Chicago", "Blackhawks"),
    Team("COL", "Colorado", "Avalanche"),
    Team("CBJ", "Columbus", "Blue Jackets"),
    Team("DAL", "Dallas", "Stars"),
    Team("DET", "Detroit", "Red Wings"),
    Team("EDM", "Edmonton", "Oilers"),
    Team("FLA", "Florida", "Panthers"),
    Team("LA", "Los Angeles", "Kings", ("LAK",)),
    Team("MIN", "Minnesota", "Wild"),
    Team("MTL", "Montreal", "Canadiens", ("MONTRÉAL",)),
    Team("NSH", "Nashville", "Predators"),
    Team("NJ", "New Jersey", "Devils", ("NJD",)),
    Team("NYI", "New York", "Islanders", ("NY ISLANDERS",)),
    Team("NYR", "New York", "Rangers", ("NY RANGERS",)),
    Team("OTT", "Ottawa", "Senators"),
    Team("PHI", "Philadelphia", "Flyers"),
    Team("PIT", "Pittsburgh", "Penguins"),
    Team("SJ", "San Jose", "Sharks", ("SJS",)),
    Team("SEA", "Seattle", "Kraken"),
    Team("STL", "St. Louis", "Blues", ("ST LOUIS", "SAINT LOUIS")),
    Team("TB", "Tampa Bay", "Lightning", ("TBL",)),
    Team("TOR", "Toronto", "Maple Leafs"),
    Team("UTA", "Utah", "Mammoth", ("UTAH HC", "UTAH HOCKEY CLUB")),
    Team("VAN", "Vancouver", "Canucks"),
    Team("VGK", "Vegas", "Golden Knights", ("LAS VEGAS",)),
    Team("WSH", "Washington", "Capitals"),
    Team("WPG", "Winnipeg", "Jets"),
]

BY_ABBR: Dict[str, Team] = {t.abbr: t for t in TEAMS}
for _t in TEAMS:
    for _a in _t.aliases:
        if len(_a) <= 3:
            BY_ABBR[_a] = _t


def _norm(s: str) -> str:
    return " ".join(s.replace(".", "").replace("É", "E").upper().split())


_INDEX: Dict[str, Team] = {}
for _t in TEAMS:
    _INDEX[_norm(_t.full)] = _t
    _INDEX[_norm(_t.nickname)] = _t
    for _a in _t.aliases:
        _INDEX[_norm(_a)] = _t
# Cities that are unambiguous (New York is not).
for _t in TEAMS:
    if _t.city != "New York":
        _INDEX.setdefault(_norm(_t.city), _t)


def resolve(name: Optional[str]) -> Optional[Team]:
    """BB-Odds / DonBest / Polymarket spelling → Team, or None."""
    if not name:
        return None
    n = _norm(name)
    if n in _INDEX:
        return _INDEX[n]
    # nickname suffix ("TORONTO MAPLE LEAFS" → MAPLE LEAFS)
    for t in TEAMS:
        if n.endswith(_norm(t.nickname)):
            return t
    return None
