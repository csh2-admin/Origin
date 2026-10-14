from flask import Blueprint, jsonify, make_response, request

from ..database import create_session, delete_session, require_db

bp = Blueprint("auth", __name__)


@bp.route("/login", methods=["POST"])
def login():
    body = request.get_json()
    username = body.get("username", "")
    password = body.get("password", "")
    try:
        session_id = create_session(username, password)
    except Exception:
        return jsonify({"detail": "Invalid database credentials"}), 401
    resp = make_response(jsonify({"status": "ok", "user": username}))
    resp.set_cookie(
        "session_id", session_id,
        httponly=True, samesite="Lax", max_age=8 * 3600, path="/",
    )
    return resp


@bp.route("/logout", methods=["POST"])
def logout():
    sid = request.cookies.get("session_id")
    if sid:
        delete_session(sid)
    resp = make_response(jsonify({"status": "ok"}))
    resp.delete_cookie("session_id", path="/")
    return resp


@bp.route("/me")
@require_db
def me(conn):
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    return jsonify({"user": user})
