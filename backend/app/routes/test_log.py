from flask import Blueprint, jsonify, request

from ..database import require_db, _dict_row, _dict_rows
from ._helpers import _serialize, _parse_ts

bp = Blueprint("test_log", __name__)

TEST_LOG_COLUMNS = "test_id, test_name, start_utc, end_utc, summary, objective, known_issues, operator, created_at, updated_at"


@bp.route("/test-log", methods=["GET"])
@require_db
def list_test_log(conn):
    cur = conn.cursor()
    cur.execute(f"SELECT {TEST_LOG_COLUMNS} FROM test_log ORDER BY start_utc DESC LIMIT 500")
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/test-log", methods=["POST"])
@require_db
def create_test_log_entry(conn):
    body = request.get_json() or {}
    test_id = (body.get("test_id") or "").strip()
    test_name = (body.get("test_name") or "").strip()
    start_utc = body.get("start_utc")
    if not test_id or not test_name or not start_utc:
        return jsonify({"detail": "test_id, test_name, and start_utc are required"}), 400
    parsed_start = _parse_ts(start_utc)
    parsed_end = _parse_ts(body.get("end_utc"))
    if parsed_end and parsed_start and parsed_end <= parsed_start:
        return jsonify({"detail": "End time must be after start time"}), 400
    cur = conn.cursor()
    try:
        cur.execute(
            f"""
            INSERT INTO test_log (test_id, test_name, start_utc, end_utc, summary, objective, known_issues, operator)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {TEST_LOG_COLUMNS}
            """,
            (
                test_id, test_name,
                parsed_start,
                parsed_end,
                body.get("summary") or None,
                body.get("objective") or None,
                body.get("known_issues") or None,
                body.get("operator") or None,
            ),
        )
    except Exception as e:
        conn.rollback()
        if "23505" in str(e):
            return jsonify({"detail": f"Test ID '{test_id}' already exists"}), 409
        raise
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/test-log/<test_id>", methods=["PUT"])
@require_db
def update_test_log_entry(test_id, conn):
    body = request.get_json() or {}
    allowed = {"test_name", "start_utc", "end_utc", "summary", "objective", "known_issues", "operator"}
    sets = []
    params = []
    for key in allowed:
        if key in body:
            val = body[key]
            if key in ("start_utc", "end_utc"):
                val = _parse_ts(val)
            elif val is not None:
                val = str(val).strip() if val else None
            sets.append(f"{key} = %s")
            params.append(val)
    if not sets:
        return jsonify({"detail": "No fields to update"}), 400
    params.append(test_id)
    cur = conn.cursor()
    cur.execute(
        f"UPDATE test_log SET {', '.join(sets)} WHERE test_id = %s RETURNING {TEST_LOG_COLUMNS}",
        params,
    )
    row = _dict_row(cur)
    if not row:
        return jsonify({"detail": "Not found"}), 404
    conn.commit()
    return jsonify(_serialize(row))


@bp.route("/test-log/<test_id>", methods=["DELETE"])
@require_db
def delete_test_log_entry(test_id, conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM test_log WHERE test_id = %s RETURNING test_id", (test_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    conn.commit()
    return jsonify({"status": "deleted"})
