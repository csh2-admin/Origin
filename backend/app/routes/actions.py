from flask import Blueprint, jsonify, request

from ..database import require_db, _dict_row, _dict_rows, _sessions
from ._helpers import _serialize

bp = Blueprint("actions", __name__)

ACTION_COLUMNS = "id, created_at, updated_at, memo_id, engineer, action_text, status, responsible, due_date, notes, completed_by, completed_at"


@bp.route("/actions", methods=["GET"])
@require_db
def list_actions(conn):
    cur = conn.cursor()
    conditions = []
    params = []
    engineer = request.args.get("engineer", "").strip()
    status = request.args.get("status", "").strip()
    search = request.args.get("search", "").strip()
    memo_id = request.args.get("memo_id", "").strip()
    if engineer:
        conditions.append("engineer = %s")
        params.append(engineer)
    if memo_id:
        conditions.append("memo_id = %s")
        params.append(int(memo_id))
    if status:
        conditions.append("status = %s")
        params.append(status)
    if search:
        conditions.append("action_text ILIKE %s")
        params.append(f"%{search}%")
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    cur.execute(
        f"SELECT {ACTION_COLUMNS} FROM action_items{where} ORDER BY created_at DESC",
        params,
    )
    rows = _dict_rows(cur)
    return jsonify([_serialize(r) for r in rows])


@bp.route("/actions", methods=["POST"])
@require_db
def create_action(conn):
    body = request.get_json() or {}
    action_text = (body.get("action_text") or "").strip()
    if not action_text:
        return jsonify({"detail": "action_text is required"}), 400
    cur = conn.cursor()
    cur.execute(
        f"""
        INSERT INTO action_items (engineer, action_text, status, responsible, due_date, notes, memo_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING {ACTION_COLUMNS}
        """,
        (
            body.get("engineer", ""),
            action_text,
            body.get("status", "Not Started"),
            body.get("responsible", ""),
            body.get("due_date") or None,
            body.get("notes", ""),
            body.get("memo_id") or None,
        ),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/actions/<int:action_id>", methods=["PUT"])
@require_db
def update_action(action_id, conn):
    body = request.get_json() or {}
    allowed = {"action_text", "status", "responsible", "due_date", "notes"}
    sets = []
    params = []
    for key in allowed:
        if key in body:
            val = body[key]
            if key == "due_date" and (val is None or str(val).strip() == ""):
                val = None
            sets.append(f"{key} = %s")
            params.append(val)
    if not sets:
        return jsonify({"detail": "No fields to update"}), 400
    if body.get("status") == "Complete":
        sets.append("completed_by = %s")
        sid = request.cookies.get("session_id", "")
        current_user = _sessions.get(sid, {}).get("username", "")
        params.append(body.get("completed_by", current_user))
        sets.append("completed_at = NOW()")
    elif "status" in body and body["status"] != "Complete":
        sets.append("completed_by = NULL")
        sets.append("completed_at = NULL")
    sets.append("updated_at = NOW()")
    params.append(action_id)
    cur = conn.cursor()
    cur.execute(
        f"UPDATE action_items SET {', '.join(sets)} WHERE id = %s RETURNING {ACTION_COLUMNS}",
        params,
    )
    row = _dict_row(cur)
    if not row:
        return jsonify({"detail": "Not found"}), 404
    conn.commit()
    return jsonify(_serialize(row))


@bp.route("/actions/<int:action_id>", methods=["DELETE"])
@require_db
def delete_action(action_id, conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM action_items WHERE id = %s", (action_id,))
    conn.commit()
    if cur.rowcount == 0:
        return jsonify({"detail": "Not found"}), 404
    return jsonify({"status": "deleted"})
