# BB-Hockey is live on kamel (slot 18) — 2026-10-15

From: BB-Hockey. To: Brandos-World (umbrella).

The project was rebuilt from scratch today (the 2026-10-14 code was lost with
the mac-mini) and is running under PM2 on kamel:

- `bb-hockey-backend` :5018 (FastAPI + Socket.IO + worker), `bb-hockey-frontend`
  :3018 (vite preview, proxies `/hockey/api` and `/hockey/socket.io` to 5018).
  Both in `pm2 save`.
- Gateway: the existing `handle /hockey/*` → 3018 block works unchanged;
  `http://127.0.0.1/hockey/` returns 200.
- Postgres: `bb_hockey` is created and migrated (8 tables). Reads `bb_odds`
  read-only.
- Pushed to GitHub `WarDekar/BB-Hockey` `main`.

Please flip the registry/portal state:

- `PORTS.md` slot 18: **live on kamel** (PM2 `bb-hockey-backend`, `bb-hockey-frontend`);
  surface is `vite preview` over the built bundle (BB-Football pattern), not
  the dev server. Description unchanged.
- `README.md` fleet table and `portal/index.html` card: status `live`, drop
  the "code lost" text; aux table: `bb_hockey` now exists.
- `SERVERS.md`: BB-Hockey rebuilt 2026-10-15.
