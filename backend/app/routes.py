from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from .database import create_session, delete_session, get_db
from .models import ChangeRequest, LoginRequest

router = APIRouter()


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    try:
        session_id = await create_session(body.username, body.password)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid database credentials")
    response.set_cookie(
        "session_id", session_id,
        httponly=True, samesite="lax", max_age=8 * 3600,
    )
    return {"status": "ok", "user": body.username}


@router.post("/logout")
async def logout(request: Request, response: Response):
    sid = request.cookies.get("session_id")
    if sid:
        delete_session(sid)
    response.delete_cookie("session_id")
    return {"status": "ok"}


@router.get("/me")
async def me(conn: asyncpg.Connection = Depends(get_db)):
    try:
        user = await conn.fetchval("SELECT session_user")
        return {"user": user}
    finally:
        await conn.close()


@router.get("/state")
async def get_state(
    at: datetime | None = Query(default=None),
    conn: asyncpg.Connection = Depends(get_db),
):
    try:
        ts = at if at else datetime.now(timezone.utc)
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (p.name)
                p.name         AS position,
                p.display_name,
                e.installed_part_number   AS part_number,
                e.installed_part_revision AS part_revision,
                e.installed_part_serial   AS part_serial,
                e.effective_time          AS last_changed,
                e.changed_by
            FROM positions p
            LEFT JOIN change_events e
                ON e.position = p.name
                AND e.effective_time <= $1
            ORDER BY p.name, e.effective_time DESC, e.recorded_time DESC
            """,
            ts,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


@router.get("/component/{position}/history")
async def get_history(
    position: str,
    conn: asyncpg.Connection = Depends(get_db),
):
    try:
        rows = await conn.fetch(
            """
            SELECT id, effective_time, recorded_time, position,
                   removed_part_number, removed_part_revision, removed_part_serial,
                   installed_part_number, installed_part_revision, installed_part_serial,
                   changed_by, note
            FROM change_events
            WHERE position = $1
            ORDER BY effective_time DESC, recorded_time DESC
            """,
            position,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


@router.post("/change")
async def post_change(
    body: ChangeRequest,
    conn: asyncpg.Connection = Depends(get_db),
):
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO change_events (
                effective_time, position,
                removed_part_number, removed_part_revision, removed_part_serial,
                installed_part_number, installed_part_revision, installed_part_serial,
                note
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING id, effective_time, recorded_time, position,
                      removed_part_number, removed_part_revision, removed_part_serial,
                      installed_part_number, installed_part_revision, installed_part_serial,
                      changed_by, note
            """,
            body.effective_time, body.position,
            body.removed_part_number, body.removed_part_revision, body.removed_part_serial,
            body.installed_part_number, body.installed_part_revision, body.installed_part_serial,
            body.note,
        )
        return dict(row)
    finally:
        await conn.close()
