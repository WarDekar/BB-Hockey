"""BB-Hockey API + Socket.IO + static SPA host.

Prefix-aware for the Brando's World gateway (PORTS.md slot 18, path
/hockey/, gateway block `handle` → the Vite surface on :3018 which proxies
/hockey/api and /hockey/socket.io here). This process also serves the built
SPA under /hockey/* so :5018 alone is a complete surface, like BB-Football.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from ..config import REPO, settings
from ..db import hockey_engine, odds_engine, run_migrations
from ..worker import run_forever
from .routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("bb_hockey.api")

PREFIX = settings.prefix
DIST = REPO / "web" / "dist"

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", logger=False, engineio_logger=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    task = None
    if os.environ.get("BB_HOCKEY_WORKER", "1") not in ("0", "false", "no"):
        async def push(update: dict):
            await sio.emit("update", update)
        task = asyncio.create_task(run_forever(odds_engine(), hockey_engine(), push))
        logger.info("worker started (pricing every %ss, settlement every %ss)", settings.price_interval, settings.settle_interval)
    yield
    if task:
        task.cancel()


app = FastAPI(title="BB-Hockey", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3018", "http://127.0.0.1:3018"],
    allow_origin_regex=r"https?://(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|[\w-]+\.ts\.net|[\w-]+\.local)(:\d+)?",
    allow_methods=["GET", "POST", "PUT"],
)
app.include_router(router, prefix=f"{PREFIX}/api")
app.include_router(router, prefix="/api", include_in_schema=False)


@sio.event
async def connect(sid, environ):
    await sio.emit("hello", {"ok": True}, to=sid)


if DIST.is_dir():
    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(f"{PREFIX}/")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        rel = path.removeprefix(PREFIX.strip("/") + "/").removeprefix(PREFIX.strip("/"))
        target = DIST / rel
        if rel and ".." not in rel and target.is_file():
            return FileResponse(target)
        return FileResponse(DIST / "index.html")


_sio_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")


async def asgi(scope, receive, send):
    """Socket.IO answers on both /socket.io and /hockey/socket.io."""
    if scope["type"] in ("http", "websocket"):
        p = scope.get("path", "")
        pfx = f"{PREFIX}/socket.io"
        if p.startswith(pfx):
            scope = dict(scope, path="/socket.io" + p[len(pfx):])
    await _sio_app(scope, receive, send)
