import json
import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..database import require_db, _dict_row, _dict_rows
from ._helpers import EXEMPT_POSITIONS, _serialize, _dict_row_from

logger = logging.getLogger(__name__)

bp = Blueprint("test_runs", __name__)

TEST_STEPS = ["build", "assembly", "startup", "test", "shutdown", "complete"]


@bp.route("/test-run/active")
@require_db
def get_active_test_run(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, test_type, test_name, current_step, checklist_state, notes, started_at, started_by, completed_at
        FROM test_runs
        WHERE completed_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        return jsonify(None)
    return jsonify(_serialize(_dict_row_from(cur.description, row)))


@bp.route("/test-run/history")
@require_db
def get_test_run_history(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, test_type, test_name, current_step, started_at, started_by, completed_at
        FROM test_runs
        ORDER BY started_at DESC
        LIMIT 25
        """
    )
    rows = _dict_rows(cur)
    return jsonify([_serialize(r) for r in rows])


@bp.route("/test-run/start", methods=["POST"])
@require_db
def start_test_run(conn):
    body = request.get_json() or {}
    test_type = body.get("test_type", "simplex")
    test_name = body.get("test_name")
    if test_type not in ("simplex", "triplex"):
        return jsonify({"detail": "test_type must be simplex or triplex"}), 400
    cur = conn.cursor()
    cur.execute("SELECT id FROM test_runs WHERE completed_at IS NULL LIMIT 1")
    if cur.fetchone():
        return jsonify({"detail": "A test run is already in progress"}), 409
    cur.execute(
        """
        INSERT INTO test_runs (test_type, test_name, current_step, checklist_state, started_by)
        VALUES (%s, %s, 'build', '{}', CURRENT_USER)
        RETURNING id, test_type, test_name, current_step, checklist_state, notes, started_at, started_by, completed_at
        """,
        (test_type, test_name),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/test-run/<int:run_id>/advance", methods=["POST"])
@require_db
def advance_test_run(run_id, conn):
    body = request.get_json() or {}
    cur = conn.cursor()
    cur.execute(
        "SELECT current_step, checklist_state FROM test_runs WHERE id = %s AND completed_at IS NULL",
        (run_id,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Test run not found or already completed"}), 404

    current = row[0]
    idx = TEST_STEPS.index(current)
    if idx >= len(TEST_STEPS) - 1:
        return jsonify({"detail": "Already at final step"}), 400

    next_step = TEST_STEPS[idx + 1]
    completed_at = datetime.now(timezone.utc) if next_step == "complete" else None

    checklist_state = body.get("checklist_state", row[1])

    asset_snapshot = None
    if next_step == "complete":
        cur.execute(
            """
            SELECT p.name AS position, p.display_name,
                   (SELECT installed_part_number FROM change_events ce
                    WHERE ce.position = p.name ORDER BY effective_time DESC, recorded_time DESC LIMIT 1) AS part_number,
                   (SELECT installed_part_serial FROM change_events ce
                    WHERE ce.position = p.name ORDER BY effective_time DESC, recorded_time DESC LIMIT 1) AS part_serial,
                   (SELECT installed_part_revision FROM change_events ce
                    WHERE ce.position = p.name ORDER BY effective_time DESC, recorded_time DESC LIMIT 1) AS part_revision
            FROM positions p ORDER BY p.display_name
            """
        )
        asset_snapshot = json.dumps([_serialize(r) for r in _dict_rows(cur)])

    cur.execute(
        """
        UPDATE test_runs
        SET current_step = %s, checklist_state = %s, completed_at = %s,
            asset_snapshot = COALESCE(%s, asset_snapshot)
        WHERE id = %s
        RETURNING id, test_type, test_name, current_step, checklist_state, notes, started_at, started_by, completed_at
        """,
        (next_step, checklist_state, completed_at, asset_snapshot, run_id),
    )
    result = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(result))


@bp.route("/test-run/<int:run_id>/cancel", methods=["POST"])
@require_db
def cancel_test_run(run_id, conn):
    cur = conn.cursor()
    cur.execute(
        """
        DELETE FROM test_runs WHERE id = %s AND completed_at IS NULL
        RETURNING id
        """,
        (run_id,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Test run not found or already completed"}), 404
    conn.commit()
    return jsonify({"cancelled": True, "id": run_id})


@bp.route("/test-run/<int:run_id>/checklist", methods=["PUT"])
@require_db
def update_checklist(run_id, conn):
    body = request.get_json()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE test_runs SET checklist_state = %s WHERE id = %s AND completed_at IS NULL
        RETURNING id, test_type, test_name, current_step, checklist_state, notes, started_at, started_by, completed_at
        """,
        (body.get("checklist_state", "{}"), run_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    result = _dict_row_from(cur.description, row)
    conn.commit()
    return jsonify(_serialize(result))


@bp.route("/test-run/<int:run_id>/name", methods=["PUT"])
@require_db
def update_test_name(run_id, conn):
    body = request.get_json() or {}
    test_name = (body.get("test_name") or "").strip() or None
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE test_runs SET test_name = %s WHERE id = %s AND completed_at IS NULL
        RETURNING id, test_type, test_name, current_step, checklist_state, notes, started_at, started_by, completed_at
        """,
        (test_name, run_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    result = _dict_row_from(cur.description, row)
    conn.commit()
    return jsonify(_serialize(result))


@bp.route("/test-run/<int:run_id>/notes", methods=["PUT"])
@require_db
def update_notes(run_id, conn):
    body = request.get_json()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE test_runs SET notes = %s WHERE id = %s AND completed_at IS NULL
        RETURNING id, test_type, test_name, current_step, checklist_state, notes, started_at, started_by, completed_at
        """,
        (body.get("notes", ""), run_id),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    result = _dict_row_from(cur.description, row)
    conn.commit()
    return jsonify(_serialize(result))


@bp.route("/test-run/<int:run_id>/report")
@require_db
def get_test_report(run_id, conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, test_type, test_name, current_step, checklist_state, notes,
               started_at, started_by, completed_at, asset_snapshot
        FROM test_runs WHERE id = %s
        """,
        (run_id,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    run = _serialize(dict(zip([d[0] for d in cur.description], row)))

    asset = []
    if run.get("asset_snapshot"):
        try:
            asset = json.loads(run["asset_snapshot"]) if isinstance(run["asset_snapshot"], str) else run["asset_snapshot"]
        except Exception:
            asset = []

    assembly_notes = []
    procedure_steps = []
    try:
        test_start = run.get("started_at")
        test_end = run.get("completed_at")
        cur.execute(
            """
            SELECT ar.id, ar.sub_page, ar.pump_head,
                   ar.started_at, ar.completed_at, ar.completed_by
            FROM assembly_runs ar
            WHERE ar.started_at >= %s
              AND ar.started_at <= COALESCE(%s, now())
            ORDER BY ar.started_at
            """,
            (test_start, test_end),
        )
        assembly_runs = [_serialize(r) for r in _dict_rows(cur)]

        run_ids = [a["id"] for a in assembly_runs]
        if run_ids:
            placeholders = ",".join(["%s"] * len(run_ids))
            cur.execute(
                f"""
                SELECT asl.run_id, asl.step_order, asl.notes,
                       asl.checked_at, asl.torque_actual,
                       ai.action, ai.torque_spec, ar.sub_page, ar.pump_head
                FROM assembly_step_logs asl
                JOIN assembly_runs ar ON ar.id = asl.run_id
                JOIN assembly_instructions ai ON ai.id = asl.instruction_id
                WHERE asl.run_id IN ({placeholders})
                ORDER BY ar.sub_page, ar.pump_head, asl.step_order
                """,
                run_ids,
            )
            all_steps = [_serialize(r) for r in _dict_rows(cur)]

            for s in all_steps:
                if s["sub_page"] in ("startup_procedure", "shutdown_procedure"):
                    procedure_steps.append(s)
                elif s.get("notes"):
                    assembly_notes.append(s)
    except Exception as exc:
        logger.warning("[Report] assembly query failed: %s", exc)
        conn.rollback()

    started_at = run.get("started_at", "")
    memos = []
    if started_at:
        try:
            cur.execute(
                """
                SELECT id, logged_at, engineer, activity_type, summary,
                       issues_found, action_items, severity, maintenance_done,
                       source_file, raw_transcript, audio_url
                FROM memo_log
                WHERE logged_at::date = %s::date
                ORDER BY
                    CASE severity
                        WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                        WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5
                    END,
                    logged_at
                """,
                (started_at,),
            )
            memos = [_serialize(r) for r in _dict_rows(cur)]
        except Exception as exc:
            logger.warning("[Report] memos query failed: %s", exc)
            conn.rollback()

    actions = []
    if started_at:
        try:
            cur.execute(
                """
                SELECT id, action_text, status, responsible, due_date, notes, created_at
                FROM action_items
                WHERE created_at::date <= %s::date
                  AND (status IS NULL OR status NOT IN ('done', 'completed'))
                ORDER BY
                    CASE WHEN due_date IS NOT NULL AND due_date <= %s::date THEN 0 ELSE 1 END,
                    due_date NULLS LAST, created_at
                """,
                (started_at, started_at),
            )
            actions = [_serialize(r) for r in _dict_rows(cur)]
        except Exception as exc:
            logger.warning("[Report] actions query failed: %s", exc)
            conn.rollback()

    timeline = []
    if started_at:
        test_end_ts = run.get("completed_at") or None

        try:
            cur.execute(
                """
                SELECT id, position, caption, photo_type, taken_at, uploaded_by,
                       p.display_name
                FROM component_photos cp
                JOIN positions p ON p.name = cp.position
                WHERE cp.taken_at >= %s
                  AND cp.taken_at <= COALESCE(%s, now())
                ORDER BY cp.taken_at
                """,
                (started_at, test_end_ts),
            )
            for r in _dict_rows(cur):
                sr = _serialize(r)
                sr["event_type"] = "photo"
                timeline.append(sr)
        except Exception as exc:
            logger.warning("[Report] timeline photos query failed: %s", exc)
            conn.rollback()

        for m in memos:
            evt = dict(m)
            if m.get("source_file") in ("Field Note", "Voice Note"):
                evt["event_type"] = "field_note"
            else:
                evt["event_type"] = "memo"
            timeline.append(evt)

        for a in actions:
            if a.get("created_at"):
                evt = dict(a)
                evt["event_type"] = "action"
                timeline.append(evt)

        timeline.sort(key=lambda e: e.get("effective_time") or e.get("taken_at") or e.get("logged_at") or e.get("created_at") or "")

    return jsonify({
        "run": run,
        "asset_snapshot": asset,
        "assembly_notes": assembly_notes,
        "procedure_steps": procedure_steps,
        "memos": memos,
        "actions": actions,
        "timeline": timeline,
    })


@bp.route("/test-run/verify-assembly")
@require_db
def verify_assembly(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT p.name, p.display_name,
               (SELECT installed_part_number
                FROM change_events ce
                WHERE ce.position = p.name
                ORDER BY effective_time DESC, recorded_time DESC
                LIMIT 1) AS part_number
        FROM positions p
        ORDER BY p.display_name
        """
    )
    rows = _dict_rows(cur)
    countable = [r for r in rows if r.get("name") not in EXEMPT_POSITIONS]
    missing = [r for r in countable if not r.get("part_number")]
    return jsonify({
        "complete": len(missing) == 0,
        "missing": [_serialize(r) for r in missing],
        "total": len(countable),
        "installed": len(countable) - len(missing),
    })
