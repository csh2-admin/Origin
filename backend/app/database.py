import os
import time
import uuid
from functools import wraps

import psycopg
from psycopg.rows import dict_row
from flask import request, jsonify

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "csh2-database")
DB_SSLMODE = os.environ.get("DB_SSLMODE", "require")

SESSION_TTL = 8 * 3600

_sessions: dict[str, dict] = {}


def _conninfo(username, password):
    return psycopg.conninfo.make_conninfo(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=username, password=password, sslmode=DB_SSLMODE,
    )


def create_session(username, password):
    with psycopg.connect(_conninfo(username, password)):
        pass
    session_id = uuid.uuid4().hex
    _sessions[session_id] = {
        "username": username,
        "password": password,
        "created_at": time.time(),
    }
    return session_id


def delete_session(session_id):
    _sessions.pop(session_id, None)


def require_db(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        session_id = request.cookies.get("session_id")
        if not session_id or session_id not in _sessions:
            return jsonify({"detail": "Not authenticated"}), 401

        session = _sessions[session_id]
        if time.time() - session["created_at"] > SESSION_TTL:
            _sessions.pop(session_id, None)
            return jsonify({"detail": "Session expired"}), 401

        with psycopg.connect(
            _conninfo(session["username"], session["password"]),
            row_factory=dict_row,
        ) as conn:
            return f(*args, conn=conn, **kwargs)

    return wrapper
