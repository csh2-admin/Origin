from flask import Blueprint, jsonify, request

from ..database import require_db, _dict_row, _dict_rows
from ._helpers import ADMIN_USERS, _serialize, _dict_row_from

bp = Blueprint("assembly", __name__)

VALID_SUB_PAGES = {"seal_installation", "pump_assembly", "pump_installation", "startup_procedure", "shutdown_procedure"}
INSTRUCTION_COLUMNS = "id, sub_page, step_order, action, pns_tags, tools, torque_spec, created_by, updated_at"
RUN_COLUMNS = "id, sub_page, pump_head, started_at, completed_at, started_by, completed_by"
STEP_LOG_COLUMNS = "id, run_id, instruction_id, step_order, checked_at, torque_actual, notes"


# ── Instructions ──

@bp.route("/assembly/instructions/<sub_page>")
@require_db
def list_instructions(sub_page, conn):
    if sub_page not in VALID_SUB_PAGES:
        return jsonify({"detail": "Invalid sub_page"}), 400
    cur = conn.cursor()
    cur.execute(
        f"SELECT {INSTRUCTION_COLUMNS} FROM assembly_instructions WHERE sub_page = %s ORDER BY step_order",
        (sub_page,),
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/assembly/instructions/<sub_page>", methods=["POST"])
@require_db
def add_instruction(sub_page, conn):
    if sub_page not in VALID_SUB_PAGES:
        return jsonify({"detail": "Invalid sub_page"}), 400
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    if user not in ADMIN_USERS:
        return jsonify({"detail": "Admin access required to edit instructions"}), 403
    body = request.get_json() or {}
    cur.execute(
        "SELECT COALESCE(MAX(step_order), 0) + 1 FROM assembly_instructions WHERE sub_page = %s",
        (sub_page,),
    )
    next_order = cur.fetchone()[0]
    cur.execute(
        f"""
        INSERT INTO assembly_instructions (sub_page, step_order, action, pns_tags, tools, torque_spec)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING {INSTRUCTION_COLUMNS}
        """,
        (
            sub_page,
            body.get("step_order", next_order),
            body.get("action", ""),
            body.get("pns_tags", ""),
            body.get("tools", ""),
            body.get("torque_spec", ""),
        ),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/assembly/instructions/<sub_page>/<int:instr_id>", methods=["PUT"])
@require_db
def update_instruction(sub_page, instr_id, conn):
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    if user not in ADMIN_USERS:
        return jsonify({"detail": "Admin access required to edit instructions"}), 403
    body = request.get_json() or {}
    allowed = {"action", "pns_tags", "tools", "torque_spec", "step_order"}
    sets = []
    params = []
    for key in allowed:
        if key in body:
            sets.append(f"{key} = %s")
            params.append(body[key])
    if not sets:
        return jsonify({"detail": "No fields to update"}), 400
    sets.append("updated_at = NOW()")
    params.extend([instr_id, sub_page])
    cur.execute(
        f"UPDATE assembly_instructions SET {', '.join(sets)} WHERE id = %s AND sub_page = %s RETURNING {INSTRUCTION_COLUMNS}",
        params,
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    result = _dict_row_from(cur.description, row)
    conn.commit()
    return jsonify(_serialize(result))


@bp.route("/assembly/instructions/<sub_page>/<int:instr_id>", methods=["DELETE"])
@require_db
def delete_instruction(sub_page, instr_id, conn):
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    if user not in ADMIN_USERS:
        return jsonify({"detail": "Admin access required to edit instructions"}), 403
    cur.execute(
        "DELETE FROM assembly_instructions WHERE id = %s AND sub_page = %s",
        (instr_id, sub_page),
    )
    conn.commit()
    if cur.rowcount == 0:
        return jsonify({"detail": "Not found"}), 404
    return jsonify({"status": "deleted"})


@bp.route("/assembly/instructions/<sub_page>/reorder", methods=["PUT"])
@require_db
def reorder_instructions(sub_page, conn):
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    if user not in ADMIN_USERS:
        return jsonify({"detail": "Admin access required to edit instructions"}), 403
    body = request.get_json() or {}
    order = body.get("order", [])
    for idx, instr_id in enumerate(order, 1):
        cur.execute(
            "UPDATE assembly_instructions SET step_order = %s WHERE id = %s AND sub_page = %s",
            (idx, instr_id, sub_page),
        )
    conn.commit()
    return jsonify({"status": "ok"})


# ── Runs ──

@bp.route("/assembly/runs/<sub_page>")
@require_db
def list_assembly_runs(sub_page, conn):
    if sub_page not in VALID_SUB_PAGES:
        return jsonify({"detail": "Invalid sub_page"}), 400
    cur = conn.cursor()
    cur.execute(
        f"SELECT {RUN_COLUMNS} FROM assembly_runs WHERE sub_page = %s ORDER BY started_at DESC LIMIT 50",
        (sub_page,),
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/assembly/runs/<sub_page>/start", methods=["POST"])
@require_db
def start_assembly_run(sub_page, conn):
    if sub_page not in VALID_SUB_PAGES:
        return jsonify({"detail": "Invalid sub_page"}), 400
    body = request.get_json() or {}
    pump_head = body.get("pump_head", 1)
    if pump_head not in (0, 1, 2, 3):
        return jsonify({"detail": "pump_head must be 0, 1, 2, or 3"}), 400
    cur = conn.cursor()
    cur.execute(
        f"""
        INSERT INTO assembly_runs (sub_page, pump_head)
        VALUES (%s, %s)
        RETURNING {RUN_COLUMNS}
        """,
        (sub_page, pump_head),
    )
    run = _dict_row(cur)
    run_id = run["id"]
    cur.execute(
        "SELECT id, step_order FROM assembly_instructions WHERE sub_page = %s ORDER BY step_order",
        (sub_page,),
    )
    instructions = cur.fetchall()
    for instr_id, step_order in instructions:
        cur.execute(
            "INSERT INTO assembly_step_logs (run_id, instruction_id, step_order) VALUES (%s, %s, %s)",
            (run_id, instr_id, step_order),
        )
    conn.commit()
    cur.execute(
        f"SELECT {STEP_LOG_COLUMNS} FROM assembly_step_logs WHERE run_id = %s ORDER BY step_order",
        (run_id,),
    )
    steps = [_serialize(r) for r in _dict_rows(cur)]
    result = _serialize(run)
    result["steps"] = steps
    return jsonify(result), 201


@bp.route("/assembly/runs/<int:run_id>")
@require_db
def get_assembly_run(run_id, conn):
    cur = conn.cursor()
    cur.execute(f"SELECT {RUN_COLUMNS} FROM assembly_runs WHERE id = %s", (run_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    run = _serialize(_dict_row_from(cur.description, row))
    cur.execute(
        f"SELECT {STEP_LOG_COLUMNS} FROM assembly_step_logs WHERE run_id = %s ORDER BY step_order",
        (run_id,),
    )
    run["steps"] = [_serialize(r) for r in _dict_rows(cur)]
    cur.execute(
        f"SELECT {INSTRUCTION_COLUMNS} FROM assembly_instructions WHERE sub_page = %s ORDER BY step_order",
        (run["sub_page"],),
    )
    run["instructions"] = [_serialize(r) for r in _dict_rows(cur)]
    return jsonify(run)


@bp.route("/assembly/runs/<int:run_id>/step/<int:step_id>", methods=["PUT"])
@require_db
def update_assembly_step(run_id, step_id, conn):
    body = request.get_json() or {}
    cur = conn.cursor()
    sets = []
    params = []
    if "checked" in body:
        if body["checked"]:
            sets.append("checked_at = NOW()")
        else:
            sets.append("checked_at = NULL")
    if "torque_actual" in body:
        sets.append("torque_actual = %s")
        params.append(body["torque_actual"])
    if "notes" in body:
        sets.append("notes = %s")
        params.append(body["notes"])
    if not sets:
        return jsonify({"detail": "No fields to update"}), 400
    params.extend([step_id, run_id])
    cur.execute(
        f"UPDATE assembly_step_logs SET {', '.join(sets)} WHERE id = %s AND run_id = %s RETURNING {STEP_LOG_COLUMNS}",
        params,
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    result = _dict_row_from(cur.description, row)
    conn.commit()
    return jsonify(_serialize(result))


@bp.route("/assembly/runs/<int:run_id>", methods=["DELETE"])
@require_db
def delete_assembly_run(run_id, conn):
    cur = conn.cursor()
    cur.execute("SELECT completed_at FROM assembly_runs WHERE id = %s", (run_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    if row[0] is not None:
        return jsonify({"detail": "Cannot delete a completed run"}), 400
    cur.execute("DELETE FROM assembly_step_logs WHERE run_id = %s", (run_id,))
    cur.execute("DELETE FROM assembly_runs WHERE id = %s", (run_id,))
    conn.commit()
    return jsonify({"status": "deleted"})


@bp.route("/assembly/runs/<int:run_id>/complete", methods=["POST"])
@require_db
def complete_assembly_run(run_id, conn):
    cur = conn.cursor()
    cur.execute(
        f"UPDATE assembly_runs SET completed_at = NOW(), completed_by = session_user WHERE id = %s AND completed_at IS NULL RETURNING {RUN_COLUMNS}",
        (run_id,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found or already completed"}), 404
    result = _dict_row_from(cur.description, row)
    conn.commit()
    return jsonify(_serialize(result))
