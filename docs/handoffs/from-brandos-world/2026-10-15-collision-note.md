# 2026-10-15 — a second session wrote into this checkout for ~20 minutes; here is what to check

**From:** the Brandos-World session (fleet rebuild on kamel). **To:** the BB-Hockey session (tmux `Hockey-7`).

Between roughly 14:05 and 14:25 PT I was also building BB-Hockey from scratch in this directory, not
knowing your session had started at 14:05. I stopped as soon as I saw your `bb_hockey/` package and your
rows in `bb_hockey`. Everything I wrote has been MOVED OUT to
`/private/tmp/claude-501/-Users-drkamel-Dev-Brandos-World/33ae5503-07e7-4ffd-aac8-78461e1ce165/scratchpad/bb-hockey-brandos-world-session/`
(src/, sql/, web/backend, web/frontend, tests, scripts, docs/API.md, pyproject.toml, ecosystem.config.js).
Nothing of mine remains in the tree except the items below. Nothing was committed.

## Things I may have overwritten (please re-check)

- `.env` (14:12) and `.gitignore` (14:12) — I wrote both with `Write`. If you had your own `.env` with
  `BB_HOCKEY_*` values, it is gone; the one on disk has my unprefixed vars (your `pydantic-settings`
  config ignores them and falls back to its defaults, so your worker kept running). `.gitignore` on disk is
  my superset list.
- `.venv` — created by me at 14:05 (`uv venv -p 3.12`); you installed `requirements.txt` into it at
  14:11. I later ran `uv pip install -e .` of MY package into it (14:23) and have since uninstalled it
  (`bb-hockey` dist). `bb-odds-client` 1.45.0 and a few extras I pulled are still installed; harmless.
- Database `bb_hockey` — `createdb` was mine (14:05). I then ran my own `sql/migrations/001_create_schema.sql`
  at 14:23; it failed on your existing `games` table after creating two tables of mine, `teams` and
  `schema_version`. I dropped both (both were empty / metadata only). None of your tables or rows were
  touched. Your `schema_migrations`, `games`, `pricing_snapshots`, `edges`, `paper_bets`,
  `calibration_obs`, `settings`, `worker_heartbeat` are as you left them.
- `tests/__pycache__` and `.pytest_cache` — I removed only my own test caches.

## What I learned that you may want (no action needed)

- Pinnacle (`www.pinnacle.com`, `guest.api.arcadia.pinnacle.com`) is unreachable from this box
  (TCP timeout, geo-blocked in Argentina), so the BB-Futures Playwright pattern cannot be reused here.
- `bb_odds` currently has ZERO NHL games (`current.games` league 3) — NHL games there were created from
  the DonBest stream schedule, and the DonBest downloader is down (subscription expired; see
  Brandos-World `SERVERS.md`). Until it returns, an anchor has to come from elsewhere.
- Public sources that do work from here, probed 14:10–14:20 PT:
  - ESPN scoreboard embeds a DraftKings block per game with ML both sides, spread ±1.5 with prices, and
    the total with over/under prices (`competitions[0].odds[0].{moneyline,pointSpread,total}.*.close`);
    finals carry `linescores` per period and `shortDetail` "Final/OT" / "Final/SO".
  - Kalshi (`/trade-api/v2/markets?series_ticker=…&status=open`) lists for every game: `KXNHLGAME`,
    `KXNHLSPREAD` (`<TEAM>2`/`<TEAM>3` = wins by 2+/3+), `KXNHLTOTAL` (floor_strike 4.5…8.5),
    `KXNHLTEAMTOTAL`, `KXNHL{1,2,3}P` (period winner incl. `TIE`), `KXNHL{1,2,3}PSPREAD`,
    `KXNHL{1,2,3}PTOTAL`, `KXNHL{1,2,3}PBTTS`, `KXNHLF10G`. Prices are in the `*_dollars` string fields
    (`yes_ask_dollars` etc.); the bare `yes_bid`/`yes_ask` are null.
  - Polymarket Gamma `events?tag_slug=nhl&active=true&closed=false` has per-game events with slug
    `nhl-<away>-<home>-<YYYY-MM-DD>` and markets tagged `sportsMarketType` ∈ {moneyline, spreads, totals},
    totals ladder 4.5–7.5.
- Fleet registration for slot 18 (`/hockey/` → :3018 `handle`, API :5018) already exists in
  Brandos-World's Caddyfile, PORTS.md and portal; when you have PM2 apps up, say so in
  `Brandos-World/docs/handoffs/for-brandos-world/` (or just tell the user) and the portal card flips from
  `lost` to `live`.

Sorry for the noise. — Brandos-World session
