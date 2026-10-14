import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..database import require_db, _dict_row, _dict_rows
from ._helpers import _serialize

logger = logging.getLogger(__name__)

bp = Blueprint("dashboard", __name__)


@bp.route("/dashboard")
@require_db
def get_dashboard(conn):
    cur = conn.cursor()

    active_run = None
    try:
        cur.execute(
            """
            SELECT id, test_type, test_name, current_step, started_at, started_by
            FROM test_runs WHERE completed_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """
        )
        row = cur.fetchone()
        if row:
            active_run = _serialize(dict(zip([d[0] for d in cur.description], row)))
    except Exception:
        conn.rollback()

    recent_changes = []
    try:
        cur.execute(
            """
            SELECT ce.id, ce.position, p.display_name, ce.effective_time,
                   ce.installed_part_number, ce.removed_part_number, ce.changed_by
            FROM change_events ce
            JOIN positions p ON p.name = ce.position
            ORDER BY ce.effective_time DESC, ce.recorded_time DESC
            LIMIT 10
            """
        )
        recent_changes = [_serialize(r) for r in _dict_rows(cur)]
    except Exception:
        conn.rollback()

    limits = []
    try:
        cur.execute(
            """
            SELECT pl.position, p.display_name, pl.limit_type, pl.limit_value
            FROM position_limits pl
            JOIN positions p ON p.name = pl.position
            """
        )
        limits = [_serialize(r) for r in _dict_rows(cur)]
    except Exception:
        conn.rollback()

    return jsonify({
        "active_run": active_run,
        "recent_changes": recent_changes,
        "limits": limits,
    })


@bp.route("/daily-log")
@require_db
def get_daily_log(conn):
    date_str = request.args.get("date")
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    cur = conn.cursor()

    field_notes = []
    try:
        cur.execute(
            """
            SELECT id, logged_at, engineer, activity_type, summary,
                   raw_transcript, audio_url, source_file
            FROM memo_log
            WHERE logged_at::date = %s::date
            ORDER BY logged_at
            """,
            (date_str,),
        )
        field_notes = [_serialize(r) for r in _dict_rows(cur)]
    except Exception as exc:
        logger.warning("[DailyLog] field notes query failed: %s", exc)
        conn.rollback()

    try:
        if field_notes:
            ids = [r["id"] for r in field_notes]
            placeholders = ",".join(["%s"] * len(ids))
            cur.execute(
                f"SELECT memo_id, COUNT(*) AS cnt FROM field_note_replies WHERE memo_id IN ({placeholders}) GROUP BY memo_id",
                ids,
            )
            counts = {r["memo_id"]: r["cnt"] for r in _dict_rows(cur)}
            for r in field_notes:
                r["reply_count"] = counts.get(r["id"], 0)
    except Exception:
        logger.warning("[DailyLog] reply counts query failed — check permissions on field_note_replies")
        conn.rollback()
        for r in field_notes:
            r["reply_count"] = 0

    test_runs = []
    try:
        cur.execute(
            """
            SELECT id, test_type, test_name, current_step, checklist_state, notes,
                   started_at, started_by, completed_at
            FROM test_runs
            WHERE started_at::date <= %s::date
              AND (completed_at IS NULL OR completed_at::date >= %s::date)
            ORDER BY started_at
            """,
            (date_str, date_str),
        )
        test_runs = [_serialize(r) for r in _dict_rows(cur)]
    except Exception as exc:
        logger.warning("[DailyLog] test runs query failed: %s", exc)
        conn.rollback()

    asset_config = []
    try:
        eod = date_str + "T23:59:59+00:00"
        cur.execute(
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
            (eod,),
        )
        asset_config = [_serialize(r) for r in _dict_rows(cur)]
    except Exception as exc:
        logger.warning("[DailyLog] asset config query failed: %s", exc)
        conn.rollback()

    change_events = []
    try:
        cur.execute(
            """
            SELECT ce.id, ce.position, p.display_name, ce.effective_time,
                   ce.installed_part_number, ce.installed_part_revision, ce.installed_part_serial,
                   ce.removed_part_number, ce.removed_part_revision, ce.removed_part_serial,
                   ce.changed_by, ce.note
            FROM change_events ce
            JOIN positions p ON p.name = ce.position
            WHERE ce.effective_time::date = %s::date
            ORDER BY ce.effective_time
            """,
            (date_str,),
        )
        change_events = [_serialize(r) for r in _dict_rows(cur)]
    except Exception as exc:
        logger.warning("[DailyLog] change events query failed: %s", exc)
        conn.rollback()

    action_items = []
    try:
        cur.execute(
            """
            SELECT id, action_text, status, responsible, due_date, notes, created_at
            FROM action_items
            WHERE created_at::date = %s::date
            ORDER BY created_at
            """,
            (date_str,),
        )
        action_items = [_serialize(r) for r in _dict_rows(cur)]
    except Exception as exc:
        logger.warning("[DailyLog] action items query failed: %s", exc)
        conn.rollback()

    return jsonify({
        "date": date_str,
        "field_notes": field_notes,
        "test_runs": test_runs,
        "asset_config": asset_config,
        "change_events": change_events,
        "action_items": action_items,
    })
