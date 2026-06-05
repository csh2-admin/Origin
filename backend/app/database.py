import os
import ssl
import time
import uuid
from functools import wraps

import pg8000.dbapi
from flask import jsonify, request

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "csh2-database")
DB_SSLMODE = os.environ.get("DB_SSLMODE", "require")

SESSION_TTL = 8 * 3600

_sessions: dict[str, dict] = {}


def _connect(username, password):
    ssl_context = None
    if DB_SSLMODE != "disable":
        ssl_context = ssl.create_default_context()
    return pg8000.dbapi.connect(
        host=DB_HOST, port=DB_PORT, database=DB_NAME,
        user=username, password=password, ssl_context=ssl_context,
    )


def _dict_rows(cursor):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _dict_row(cursor):
    cols = [d[0] for d in cursor.description]
    row = cursor.fetchone()
    return dict(zip(cols, row)) if row else None


def create_session(username, password):
    conn = _connect(username, password)
    conn.close()
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

        conn = _connect(session["username"], session["password"])
        try:
            return f(*args, conn=conn, **kwargs)
        finally:
            conn.close()

    return wrapper
