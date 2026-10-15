# BB-Hockey — fresh session pickup

1. `CLAUDE.md` — what this is, hard rules, the assumptions, what is next.
2. `docs/handoffs/` — outbound notes (`for-*`) and anything copied in (`from-*`).
3. Fast orientation:

```bash
git status
pm2 status bb-hockey-backend bb-hockey-frontend
curl -s localhost:5018/hockey/api/health | head -c 400
tail -20 logs/bb-hockey-backend.err.log
./.venv/bin/python -m pytest -q
psql -d bb_hockey -Atc "select job,last_run_at,note from worker_heartbeat"
```

After Python changes: `pm2 restart bb-hockey-backend`. After frontend
changes: `cd web && npm run build && pm2 restart bb-hockey-frontend` (the
:5018 SPA picks up a new dist without a restart).
