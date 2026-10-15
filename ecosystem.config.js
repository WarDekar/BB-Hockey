// PM2 process definitions for BB-Hockey (fleet slot 18, registry Brandos-World/PORTS.md).
//
// Logs go to <repo>/logs (gitignored), not /tmp and not ~/.pm2/logs — same
// convention as BB-Football/BB-Futures.
//
//   bb-hockey-backend   :5018  FastAPI + Socket.IO + the pricing/settlement
//                              worker (in-process asyncio). Also serves the
//                              built SPA (web/dist) prefix-aware under /hockey/*,
//                              so :5018 alone is a complete surface.
//   bb-hockey-frontend  :3018  vite preview over the built bundle, proxying
//                              /hockey/api and /hockey/socket.io to :5018. This
//                              is the gateway's upstream (`handle /hockey/*` → 3018).
//
// Rebuild the frontend with `cd web && npm run build` before restarting
// bb-hockey-frontend; restart bb-hockey-backend after Python changes.

const path = require('path');

const REPO = __dirname;
const LOG_DIR = path.join(REPO, 'logs');

module.exports = {
  apps: [
    {
      name: 'bb-hockey-backend',
      cwd: REPO,
      script: path.join(REPO, '.venv/bin/python'),
      interpreter: 'none',
      // 0.0.0.0: reachable over the tailnet directly as well as via the gateway.
      // No --reload under PM2: it spawns a child PM2 cannot see.
      args: '-m uvicorn bb_hockey.api.main:asgi --host 0.0.0.0 --port 5018 --no-access-log',
      autorestart: true,
      out_file: `${LOG_DIR}/bb-hockey-backend.out.log`,
      error_file: `${LOG_DIR}/bb-hockey-backend.err.log`,
      env: { PYTHONUNBUFFERED: '1' },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
    },
    {
      name: 'bb-hockey-frontend',
      cwd: path.join(REPO, 'web'),
      script: path.join(REPO, 'web/node_modules/.bin/vite'),
      interpreter: 'none',
      args: 'preview',
      autorestart: true,
      out_file: `${LOG_DIR}/bb-hockey-frontend.out.log`,
      error_file: `${LOG_DIR}/bb-hockey-frontend.err.log`,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      watch: false,
    },
  ],
};
