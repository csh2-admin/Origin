from datetime import datetime, timezone

from flask import Blueprint, jsonify, make_response, request

from .database import create_session, delete_session, require_db

bp = Blueprint("api", __name__)


def _serialize(row):
    return {
        k: (v.isoformat() if isinstance(v, datetime) else v)
        for k, v in row.items()
    }


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
        httponly=True, samesite="Lax", max_age=8 * 3600,
    )
    return resp


@bp.route("/logout", methods=["POST"])
def logout():
    sid = request.cookies.get("session_id")
    if sid:
        delete_session(sid)
    resp = make_response(jsonify({"status": "ok"}))
    resp.delete_cookie("session_id")
    return resp


@bp.route("/me")
@require_db
def me(conn):
    user = conn.execute("SELECT session_user").fetchone()["session_user"]
    return jsonify({"user": user})


@bp.route("/state")
@require_db
def get_state(conn):
    at_param = request.args.get("at")
    if at_param:
        ts = datetime.fromisoformat(at_param)
    else:
        ts = datetime.now(timezone.utc)

    rows = conn.execute(
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
            AND e.effective_time <= %s
        ORDER BY p.name, e.effective_time DESC, e.recorded_time DESC
        """,
        (ts,),
    ).fetchall()
    return jsonify([_serialize(r) for r in rows])


@bp.route("/component/<position>/history")
@require_db
def get_history(position, conn):
    rows = conn.execute(
        """
        SELECT id, effective_time, recorded_time, position,
               removed_part_number, removed_part_revision, removed_part_serial,
               installed_part_number, installed_part_revision, installed_part_serial,
               changed_by, note
        FROM change_events
        WHERE position = %s
        ORDER BY effective_time DESC, recorded_time DESC
        """,
        (position,),
    ).fetchall()
    return jsonify([_serialize(r) for r in rows])


@bp.route("/change", methods=["POST"])
@require_db
def post_change(conn):
    body = request.get_json()
    row = conn.execute(
        """
        INSERT INTO change_events (
            effective_time, position,
            removed_part_number, removed_part_revision, removed_part_serial,
            installed_part_number, installed_part_revision, installed_part_serial,
            note
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id, effective_time, recorded_time, position,
                  removed_part_number, removed_part_revision, removed_part_serial,
                  installed_part_number, installed_part_revision, installed_part_serial,
                  changed_by, note
        """,
        (
            datetime.fromisoformat(body["effective_time"]),
            body["position"],
            body.get("removed_part_number"),
            body.get("removed_part_revision"),
            body.get("removed_part_serial"),
            body.get("installed_part_number"),
            body.get("installed_part_revision"),
            body.get("installed_part_serial"),
            body.get("note"),
        ),
    ).fetchone()
    conn.commit()
    return jsonify(_serialize(row))
