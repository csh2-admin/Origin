import os
import time
import uuid

import asyncpg
from fastapi import HTTPException, Request

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "asset_model")

SESSION_TTL = 8 * 3600

_sessions: dict[str, dict] = {}


async def create_session(username: str, password: str) -> str:
    conn = await asyncpg.connect(
        host=DB_HOST, port=DB_PORT, database=DB_NAME,
        user=username, password=password,
    )
    await conn.close()

    session_id = uuid.uuid4().hex
    _sessions[session_id] = {
        "username": username,
        "password": password,
        "created_at": time.time(),
    }
    return session_id


def delete_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


async def get_db(request: Request) -> asyncpg.Connection:
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in _sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = _sessions[session_id]
    if time.time() - session["created_at"] > SESSION_TTL:
        _sessions.pop(session_id, None)
        raise HTTPException(status_code=401, detail="Session expired")

    conn = await asyncpg.connect(
        host=DB_HOST, port=DB_PORT, database=DB_NAME,
        user=session["username"], password=session["password"],
    )
    return conn
