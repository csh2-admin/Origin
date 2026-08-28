import io
import json
import logging
import os
import tempfile
import threading
import time
import uuid
from datetime import date, datetime, timezone
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

from flask import Blueprint, current_app, jsonify, make_response, request
from PIL import Image
from pillow_heif import register_heif_opener

from .database import create_session, delete_session, require_db, _dict_row, _dict_rows, _sessions

register_heif_opener()

bp = Blueprint("api", __name__)

MAX_DIMENSION = 1920
JPEG_QUALITY = 85

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"}


def _serialize(row):
    return {
        k: (v.isoformat() if isinstance(v, (datetime, date)) else v)
        for k, v in row.items()
    }


GITHUB_REPO = "csh2-admin/Origin"

def _create_github_issue(title: str, body: str, labels: list[str] | None = None) -> dict:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        logger.warning("[GitHub Issue] No GITHUB_TOKEN set, skipping")
        return {"ok": False, "error": "GITHUB_TOKEN not set"}
    payload = json.dumps({"title": title, "body": body, "labels": labels or []}).encode()
    url = f"https://api.github.com/repos/{GITHUB_REPO}/issues"
    logger.info("[GitHub Issue] POST %s title=%r", url, title)
    req = Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        resp = urlopen(req, timeout=10)
        logger.info("[GitHub Issue] Success: %s", resp.status)
        return {"ok": True, "status": resp.status}
    except Exception as exc:
        logger.exception("[GitHub Issue] Failed: %s", exc)
        return {"ok": False, "error": str(exc)}


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


@bp.route("/state")
@require_db
def get_state(conn):
    at_param = request.args.get("at")
    if at_param:
        ts = datetime.fromisoformat(at_param)
    else:
        ts = datetime.now(timezone.utc)

    cur = conn.cursor()
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
        (ts,),
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


_parts_catalog_cache: dict | None = None
_parts_catalog_ts: float = 0

@bp.route("/parts-catalog")
@require_db
def parts_catalog(conn):
    global _parts_catalog_cache, _parts_catalog_ts
    if _parts_catalog_cache is None or time.time() - _parts_catalog_ts > 300:
        cur = conn.cursor()
        cur.execute("SELECT part_number, position, description FROM parts_catalog ORDER BY position, part_number")
        _parts_catalog_cache = [_serialize(r) for r in _dict_rows(cur)]
        _parts_catalog_ts = time.time()
    position = request.args.get("position")
    if position:
        data = [p for p in _parts_catalog_cache if p.get("position") == position]
    else:
        data = _parts_catalog_cache
    return jsonify(data)


@bp.route("/component/<position>/history")
@require_db
def get_history(position, conn):
    cur = conn.cursor()
    cur.execute(
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
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


_usage_cache: dict | None = None
_usage_cache_ts: float = 0

@bp.route("/usage")
@require_db
def get_all_usage(conn):
    global _usage_cache, _usage_cache_ts
    if _usage_cache is not None and time.time() - _usage_cache_ts < 120:
        return jsonify(_usage_cache)

    cur = conn.cursor()
    cur.execute(
        """
        SELECT DISTINCT ON (position) position, effective_time
        FROM change_events
        WHERE installed_part_number IS NOT NULL
        ORDER BY position, effective_time DESC, recorded_time DESC
        """
    )
    installs = {r["position"]: r["effective_time"] for r in _dict_rows(cur)}

    if not installs:
        _usage_cache = {}
        _usage_cache_ts = time.time()
        return jsonify({})

    now = datetime.now(timezone.utc)
    results = {}

    for position, installed_since in installs.items():
        window_seconds = (now - installed_since).total_seconds()
        if window_seconds > 86400:
            data_table = "procdatafloattable_utc_15sec"
            default_interval = 15.0
        elif window_seconds > 14400:
            data_table = "procdatafloattable_utc_1sec"
            default_interval = 1.0
        else:
            data_table = "procdatafloattable"
            default_interval = 1.0

        try:
            cur.execute("SET LOCAL statement_timeout = '30s'")
            cur.execute(
                f"""
                WITH motor_speed_data AS (
                    SELECT
                        COALESCE(
                            CASE WHEN t.tagname = 'M130_Freq' THEN p.val * 5.0 / 3 END,
                            CASE WHEN t.tagname = 'MC130_VFD_Speed' THEN p.val * 5.0 / 3 END
                        ) AS m130_speed
                    FROM {data_table} p
                    JOIN procdatatagtable t ON p.tagindex = t.tagindex
                    WHERE t.tagname IN ('M130_Freq', 'MC130_VFD_Speed')
                      AND p.val IS NOT NULL
                      AND p.utc_full_timestamp BETWEEN %s AND %s
                )
                SELECT
                    SUM(CASE WHEN m130_speed > 0 THEN {default_interval} ELSE 0 END) / 3600.0 AS runtime_hours,
                    AVG(CASE WHEN m130_speed > 0 THEN m130_speed END) * 5 *
                        (SUM(CASE WHEN m130_speed > 0 THEN {default_interval} ELSE 0 END) / 3600.0) * 60 AS est_cycles
                FROM motor_speed_data
                """,
                (installed_since, now),
            )
            row = cur.fetchone()
            results[position] = {
                "est_cycles": float(row[1]) if row and row[1] else 0,
                "runtime_hours": float(row[0]) if row and row[0] else 0,
                "installed_since": installed_since.isoformat() if installed_since else None,
            }
        except Exception as exc:
            logger.warning("Usage query failed for position %s: %s", position, exc)
            conn.rollback()
            results[position] = {"est_cycles": 0, "runtime_hours": 0, "installed_since": installed_since.isoformat() if installed_since else None}

    _usage_cache = results
    _usage_cache_ts = time.time()
    return jsonify(results)


@bp.route("/component/<position>/usage")
@require_db
def get_usage(position, conn):
    cur = conn.cursor()
    # Find when the current part was installed
    cur.execute(
        """
        SELECT effective_time
        FROM change_events
        WHERE position = %s AND installed_part_number IS NOT NULL
        ORDER BY effective_time DESC, recorded_time DESC
        LIMIT 1
        """,
        (position,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({
            "installed_since": None,
            "runtime_hours": 0,
            "idle_hours": 0,
            "est_cycles": 0,
            "avg_cpm": 0,
            "data_points": 0,
        })

    installed_since = row[0]
    now = datetime.now(timezone.utc)
    window_seconds = (now - installed_since).total_seconds()

    # Pick the right table based on time window size
    if window_seconds > 86400:  # > 24 hours
        data_table = "procdatafloattable_utc_15sec"
        default_interval = 15.0
    elif window_seconds > 14400:  # > 4 hours
        data_table = "procdatafloattable_utc_1sec"
        default_interval = 1.0
    else:
        data_table = "procdatafloattable"
        default_interval = 1.0

    try:
        cur.execute(
            f"""
            WITH motor_speed_data AS (
                SELECT
                    p.val * 5.0 / 3.0 AS m130_speed
                FROM {data_table} p
                JOIN procdatatagtable t ON p.tagindex = t.tagindex
                WHERE t.tagname IN ('M130_Freq', 'MC130_VFD_Speed')
                  AND p.val IS NOT NULL
                  AND p.utc_full_timestamp BETWEEN %s AND %s
            )
            SELECT
                SUM(CASE WHEN m130_speed > 0 THEN {default_interval} ELSE 0 END) / 3600.0 AS runtime_hours,
                SUM(CASE WHEN m130_speed <= 0 THEN {default_interval} ELSE 0 END) / 3600.0 AS idle_hours,
                AVG(CASE WHEN m130_speed > 0 THEN m130_speed END) * 5 AS avg_cpm,
                AVG(CASE WHEN m130_speed > 0 THEN m130_speed END) * 5 *
                    (SUM(CASE WHEN m130_speed > 0 THEN {default_interval} ELSE 0 END) / 3600.0) * 60 AS est_cycles,
                COUNT(*) AS data_points
            FROM motor_speed_data
            """,
            (installed_since, now),
        )
        result = _dict_row(cur)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        result = {
            "runtime_hours": None,
            "idle_hours": None,
            "est_cycles": None,
            "avg_cpm": None,
            "data_points": 0,
            "_error": str(exc),
        }

    result["installed_since"] = installed_since.isoformat()
    return jsonify({k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in result.items()})


@bp.route("/change", methods=["POST"])
@require_db
def post_change(conn):
    body = request.get_json()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO change_events (
            effective_time, position,
            removed_part_number, removed_part_revision, removed_part_serial,
            installed_part_number, installed_part_revision, installed_part_serial,
            note, removed_cycles, removed_hours
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id, effective_time, recorded_time, position,
                  removed_part_number, removed_part_revision, removed_part_serial,
                  installed_part_number, installed_part_revision, installed_part_serial,
                  changed_by, note, removed_cycles, removed_hours
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
            body.get("removed_cycles"),
            body.get("removed_hours"),
        ),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row))


@bp.route("/component/<position>/photos")
@require_db
def get_photos(position, conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, position, change_event_id, photo_url, caption,
               photo_type, taken_at, uploaded_by
        FROM component_photos
        WHERE position = %s
        ORDER BY taken_at DESC
        """,
        (position,),
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/component/<position>/photos", methods=["POST"])
@require_db
def upload_photo(position, conn):
    if "file" not in request.files:
        return jsonify({"detail": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"detail": "Empty filename"}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"detail": f"File type {ext} not allowed"}), 400

    photo_type = request.form.get("photo_type", "inspection")
    caption = request.form.get("caption", "")
    change_event_id = request.form.get("change_event_id")
    if change_event_id:
        change_event_id = int(change_event_id)

    pos_dir = os.path.join(current_app.config["UPLOAD_DIR"], position)
    os.makedirs(pos_dir, exist_ok=True)

    img = Image.open(file)
    img = img.convert("RGB")
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

    filename = f"{uuid.uuid4().hex}.jpg"
    out_path = os.path.join(pos_dir, filename)
    img.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
    photo_url = f"/uploads/{position}/{filename}"

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO component_photos (position, change_event_id, photo_url, caption, photo_type)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, position, change_event_id, photo_url, caption, photo_type, taken_at, uploaded_by
        """,
        (position, change_event_id, photo_url, caption, photo_type),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/photo/<int:photo_id>", methods=["DELETE"])
@require_db
def delete_photo(photo_id, conn):
    cur = conn.cursor()
    cur.execute("SELECT photo_url FROM component_photos WHERE id = %s", (photo_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404

    photo_url = row[0]
    file_path = os.path.join(current_app.config["UPLOAD_DIR"], photo_url.replace("/uploads/", ""))
    if os.path.isfile(file_path):
        os.remove(file_path)

    cur.execute("DELETE FROM component_photos WHERE id = %s", (photo_id,))
    conn.commit()
    return jsonify({"status": "ok"})


# ---- Position Limits ----

@bp.route("/position-limits")
@require_db
def get_position_limits(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT pl.position, p.display_name, pl.limit_type, pl.limit_value,
               pl.updated_by, pl.updated_at
        FROM position_limits pl
        JOIN positions p ON p.name = pl.position
        ORDER BY p.display_name
        """
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/position-limits", methods=["POST"])
@require_db
def upsert_position_limit(conn):
    body = request.get_json()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO position_limits (position, limit_type, limit_value)
        VALUES (%s, %s, %s)
        ON CONFLICT (position) DO UPDATE
        SET limit_type = EXCLUDED.limit_type,
            limit_value = EXCLUDED.limit_value,
            updated_by = session_user,
            updated_at = now()
        RETURNING position, limit_type, limit_value, updated_by, updated_at
        """,
        (body["position"], body["limit_type"], body["limit_value"]),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row))


@bp.route("/position-limits/<position>", methods=["DELETE"])
@require_db
def delete_position_limit(position, conn):
    cur = conn.cursor()
    cur.execute("DELETE FROM position_limits WHERE position = %s RETURNING position", (position,))
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found"}), 404
    conn.commit()
    return jsonify({"deleted": True})


@bp.route("/dashboard")
@require_db
def get_dashboard(conn):
    cur = conn.cursor()

    # Active test run
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

    # Recent change events
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

    # Position limits with current usage for health check
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


# ---- Test Runs ----

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

    # Parse asset snapshot
    asset = []
    if run.get("asset_snapshot"):
        try:
            asset = json.loads(run["asset_snapshot"]) if isinstance(run["asset_snapshot"], str) else run["asset_snapshot"]
        except Exception:
            asset = []

    # Assembly / startup / shutdown runs associated with this test
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
            # Step details for all runs
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

    # Weebo memos from the calendar day of test start
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

    # Open actions as of the test date
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

    # Timeline events during the test window
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


@bp.route("/daily-log")
@require_db
def get_daily_log(conn):
    date_str = request.args.get("date")
    if not date_str:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    cur = conn.cursor()

    # Field notes from this day
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

    # Reply counts for field notes (separate query — hypertable safe)
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

    # Test runs active on this day (started before end of day AND not completed before start of day)
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

    # Asset model configuration as of end of this day
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

    # Change events from this day
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

    # Action items created or updated this day
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
    EXEMPT_POSITIONS = {"inline_dcv"}
    countable = [r for r in rows if r.get("name") not in EXEMPT_POSITIONS]
    missing = [r for r in countable if not r.get("part_number")]
    return jsonify({
        "complete": len(missing) == 0,
        "missing": [_serialize(r) for r in missing],
        "total": len(countable),
        "installed": len(countable) - len(missing),
    })


@bp.route("/memos/engineers")
@require_db
def list_engineers(conn):
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT engineer FROM memo_log ORDER BY engineer")
    return jsonify([r[0] for r in cur.fetchall()])


@bp.route("/field-notes", methods=["POST"])
@require_db
def create_field_note(conn):
    import uuid
    from flask import current_app

    note = request.form.get("note", "").strip()
    engineer = request.form.get("engineer", "")
    category = request.form.get("category", "").strip() or "Unprocessed"
    responsible = request.form.get("responsible", "").strip()
    due_date = request.form.get("due_date", "").strip() or None
    if not note:
        return jsonify({"detail": "Note text is required"}), 400

    photo_urls = []
    note_dir = os.path.join(current_app.config["UPLOAD_DIR"], "field_notes")
    os.makedirs(note_dir, exist_ok=True)
    photos = request.files.getlist("photos") or []
    if not photos and "photo" in request.files:
        photos = [request.files["photo"]]
    for photo_file in photos[:4]:
        ext = os.path.splitext(photo_file.filename or "photo.jpg")[1] or ".jpg"
        filename = f"{uuid.uuid4().hex}{ext}"
        photo_file.save(os.path.join(note_dir, filename))
        photo_urls.append(f"/uploads/field_notes/{filename}")
    photo_url = json.dumps(photo_urls) if photo_urls else None

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO memo_log (
            engineer, source_file, activity_type, summary,
            raw_transcript, severity, audio_url
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id, logged_at, engineer, source_file, activity_type, summary, raw_transcript, audio_url
        """,
        (
            engineer,
            "Field Note",
            category,
            note[:200] if len(note) > 200 else note,
            note,
            "None",
            photo_url,
        ),
    )
    row = _dict_row(cur)

    tags = [t.strip() for t in category.split(",") if t.strip()] if category else []
    if "Action Item" in tags:
        memo_id = row.get("id")
        cur.execute(
            """
            INSERT INTO action_items (engineer, action_text, status, responsible, due_date, memo_id, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
            """,
            (engineer, note, "Not Started", responsible or engineer, due_date, memo_id),
        )

    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/field-notes", methods=["GET"])
@require_db
def list_field_notes(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, logged_at, engineer, activity_type, summary, raw_transcript, audio_url
        FROM memo_log
        WHERE source_file IN ('Field Note', 'Voice Note')
        ORDER BY logged_at DESC
        LIMIT 100
        """,
    )
    rows = [_serialize(r) for r in _dict_rows(cur)]
    try:
        if rows:
            ids = [r["id"] for r in rows]
            placeholders = ",".join(["%s"] * len(ids))
            cur.execute(
                f"SELECT memo_id, COUNT(*) AS cnt FROM field_note_replies WHERE memo_id IN ({placeholders}) GROUP BY memo_id",
                ids,
            )
            counts = {r["memo_id"]: r["cnt"] for r in _dict_rows(cur)}
            for r in rows:
                r["reply_count"] = counts.get(r["id"], 0)
    except Exception:
        logger.warning("Could not fetch reply counts — check permissions on field_note_replies")
        for r in rows:
            r["reply_count"] = 0
    return jsonify(rows)


@bp.route("/field-notes/<int:note_id>", methods=["PUT"])
@require_db
def update_field_note(conn, note_id):
    import uuid
    from flask import current_app

    data = None
    if request.content_type and "multipart/form-data" in request.content_type:
        note_text = request.form.get("note")
        category = request.form.get("category")
        responsible = request.form.get("responsible")
    else:
        data = request.get_json(silent=True) or {}
        note_text = data.get("note")
        category = data.get("category")
        responsible = data.get("responsible")

    updates = []
    params = []

    if note_text is not None:
        updates.append("raw_transcript = %s")
        params.append(note_text)
        updates.append("summary = %s")
        params.append(note_text[:200] if len(note_text) > 200 else note_text)

    if category is not None:
        updates.append("activity_type = %s")
        params.append(category)

    new_photos = request.files.getlist("photos") or []
    if not new_photos and "photo" in request.files:
        new_photos = [request.files["photo"]]

    # Get existing photos to preserve or replace
    existing_photos_json = None
    if request.content_type and "multipart/form-data" in request.content_type:
        existing_photos_json = request.form.get("existing_photos")
    elif data:
        existing_photos_json = data.get("existing_photos") if isinstance(data.get("existing_photos"), str) else (json.dumps(data.get("existing_photos")) if data.get("existing_photos") is not None else None)

    remove_photo = False
    if request.content_type and "multipart/form-data" in request.content_type:
        remove_photo = request.form.get("remove_photo") == "true"
    elif data:
        remove_photo = data.get("remove_photo", False)

    if remove_photo and not new_photos and existing_photos_json is None:
        updates.append("audio_url = NULL")
    elif new_photos or existing_photos_json is not None:
        kept = []
        if existing_photos_json:
            try:
                kept = json.loads(existing_photos_json)
            except (json.JSONDecodeError, TypeError):
                pass

        note_dir = os.path.join(current_app.config["UPLOAD_DIR"], "field_notes")
        os.makedirs(note_dir, exist_ok=True)
        for photo_file in new_photos[:4 - len(kept)]:
            ext = os.path.splitext(photo_file.filename or "photo.jpg")[1] or ".jpg"
            filename = f"{uuid.uuid4().hex}{ext}"
            photo_file.save(os.path.join(note_dir, filename))
            kept.append(f"/uploads/field_notes/{filename}")

        updates.append("audio_url = %s")
        params.append(json.dumps(kept[:4]) if kept else None)

    if not updates:
        return jsonify({"detail": "No fields to update"}), 400

    params.append(note_id)
    cur = conn.cursor()
    cur.execute(
        f"""
        UPDATE memo_log SET {', '.join(updates)}
        WHERE id = %s
        RETURNING id, logged_at, engineer, activity_type, summary, raw_transcript, audio_url
        """,
        params,
    )
    row = _dict_row(cur)
    if not row:
        return jsonify({"detail": "Note not found"}), 404

    if category is not None:
        cur.execute("SELECT id FROM action_items WHERE memo_id = %s", (note_id,))
        existing_action = cur.fetchone()

        tags = [t.strip() for t in category.split(",") if t.strip()] if category else []
        has_action_tag = "Action Item" in tags

        if has_action_tag and not existing_action:
            action_text = note_text if note_text is not None else (row.get("raw_transcript") or row.get("summary") or "")
            if action_text:
                cur.execute(
                    """
                    INSERT INTO action_items (engineer, action_text, status, responsible, memo_id, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        row.get("engineer", ""),
                        action_text,
                        "Not Started",
                        responsible or row.get("engineer", ""),
                        note_id,
                    ),
                )
                action_row = cur.fetchone()
                logger.info("Created action_item id=%s from field note %s", action_row[0] if action_row else None, note_id)
        elif not has_action_tag and existing_action:
            cur.execute("DELETE FROM action_items WHERE memo_id = %s", (note_id,))
            logger.info("Removed action_item for field note %s (tag removed)", note_id)
        elif has_action_tag and existing_action and note_text is not None:
            cur.execute(
                "UPDATE action_items SET action_text = %s, updated_at = NOW() WHERE memo_id = %s",
                (note_text, note_id),
            )

    conn.commit()
    return jsonify(_serialize(row))


@bp.route("/field-notes/<int:note_id>", methods=["DELETE"])
@require_db
def delete_field_note(conn, note_id):
    cur = conn.cursor()
    cur.execute("DELETE FROM memo_log WHERE id = %s RETURNING id", (note_id,))
    row = _dict_row(cur)
    if not row:
        return jsonify({"detail": "Note not found"}), 404
    conn.commit()
    return jsonify({"ok": True})


# ── Field Note Replies ──


@bp.route("/field-notes/<int:note_id>/replies", methods=["GET"])
@require_db
def get_replies(conn, note_id):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, memo_id, author, reply_text, created_at
        FROM field_note_replies
        WHERE memo_id = %s
        ORDER BY created_at ASC
        """,
        (note_id,),
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/field-notes/<int:note_id>/replies", methods=["POST"])
@require_db
def create_reply(conn, note_id):
    body = request.get_json(force=True)
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify({"detail": "Reply text is required"}), 400
    author = body.get("author", "")
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO field_note_replies (memo_id, author, reply_text)
        VALUES (%s, %s, %s)
        RETURNING id, memo_id, author, reply_text, created_at
        """,
        (note_id, author, text),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


# ── Notifications ──


@bp.route("/notifications/unread", methods=["GET"])
@require_db
def unread_notifications(conn):
    user = request.args.get("user", "").strip()
    if not user:
        return jsonify({"count": 0, "replies": []})
    cur = conn.cursor()
    cur.execute(
        "SELECT last_read_at FROM notification_reads WHERE username = %s",
        (user,),
    )
    row = _dict_row(cur)
    last_read = row["last_read_at"] if row else None

    try:
        if last_read:
            cur.execute(
                """
                SELECT id, memo_id, author, reply_text, created_at
                FROM field_note_replies
                WHERE created_at > %s AND author != %s
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (last_read, user),
            )
        else:
            cur.execute(
                """
                SELECT id, memo_id, author, reply_text, created_at
                FROM field_note_replies
                WHERE author != %s
                ORDER BY created_at DESC
                LIMIT 20
                """,
                (user,),
            )
        replies = [_serialize(r) for r in _dict_rows(cur)]
        # fetch note previews separately to avoid hypertable JOIN issues
        if replies:
            memo_ids = list({r["memo_id"] for r in replies})
            placeholders = ",".join(["%s"] * len(memo_ids))
            cur.execute(
                f"SELECT id, LEFT(raw_transcript, 80) AS preview FROM memo_log WHERE id IN ({placeholders})",
                memo_ids,
            )
            previews = {r["id"]: r["preview"] for r in _dict_rows(cur)}
            for r in replies:
                r["note_preview"] = previews.get(r["memo_id"], "")
    except Exception:
        logger.warning("Could not fetch notifications — check permissions")
        replies = []
    return jsonify({"count": len(replies), "replies": replies})


@bp.route("/notifications/read", methods=["POST"])
@require_db
def mark_notifications_read(conn):
    body = request.get_json(force=True)
    user = (body.get("user") or "").strip()
    if not user:
        return jsonify({"detail": "user required"}), 400
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO notification_reads (username, last_read_at)
        VALUES (%s, NOW())
        ON CONFLICT (username) DO UPDATE SET last_read_at = NOW()
        """,
        (user,),
    )
    conn.commit()
    return jsonify({"ok": True})


def _dict_row_from(description, row):
    cols = [d[0] for d in description]
    return dict(zip(cols, row))


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


# ── Assembly Instructions ────────────────────────────────────────────────────

VALID_SUB_PAGES = {"seal_installation", "pump_assembly", "pump_installation", "startup_procedure", "shutdown_procedure"}

ADMIN_USERS = {"engineer1", "edwardyoun", "anthonyku", "jimmyli"}

INSTRUCTION_COLUMNS = "id, sub_page, step_order, action, pns_tags, tools, torque_spec, created_by, updated_at"


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


# ── Assembly Runs ────────────────────────────────────────────────────────────

RUN_COLUMNS = "id, sub_page, pump_head, started_at, completed_at, started_by, completed_by"
STEP_LOG_COLUMNS = "id, run_id, instruction_id, step_order, checked_at, torque_actual, notes"


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


@bp.route("/feedback")
@require_db
def list_feedback(conn):
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    if user != "engineer1":
        return jsonify({"detail": "Unauthorized"}), 403
    category = request.args.get("category", "").strip()
    conditions = []
    params = []
    if category:
        conditions.append("category = %s")
        params.append(category)
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    conditions.append("resolved_at IS NULL")
    where = " WHERE " + " AND ".join(conditions)
    cur.execute(
        f"SELECT id, category, message, submitted_by, created_at FROM feedback{where} ORDER BY created_at DESC",
        tuple(params),
    )
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


@bp.route("/feedback/<int:feedback_id>/resolve", methods=["POST"])
@require_db
def resolve_feedback(feedback_id, conn):
    cur = conn.cursor()
    cur.execute("SELECT session_user")
    user = cur.fetchone()[0]
    if user != "engineer1":
        return jsonify({"detail": "Unauthorized"}), 403
    cur.execute(
        "UPDATE feedback SET resolved_at = NOW() WHERE id = %s AND resolved_at IS NULL RETURNING id",
        (feedback_id,),
    )
    row = cur.fetchone()
    if not row:
        return jsonify({"detail": "Not found or already resolved"}), 404
    conn.commit()
    return jsonify({"status": "ok"})


@bp.route("/feedback", methods=["POST"])
@require_db
def submit_feedback(conn):
    body = request.get_json() or {}
    category = body.get("category", "general")
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"detail": "Message is required"}), 400
    if category not in ("bug", "feature", "general"):
        return jsonify({"detail": "Invalid category"}), 400
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO feedback (category, message, submitted_by)
        VALUES (%s, %s, CURRENT_USER)
        RETURNING id, category, message, submitted_by, created_at
        """,
        (category, message),
    )
    row = _dict_row(cur)
    conn.commit()
    serialized = _serialize(row)
    gh = _create_github_issue(
        f"[Feedback/{category}] {message[:80]}",
        f"**Category:** {category}\n**From:** {serialized.get('submitted_by', 'unknown')}\n**Time:** {serialized.get('created_at', '')}\n\n{message}",
        ["feedback"],
    )
    serialized["github_issue"] = gh
    return jsonify(serialized), 201


@bp.route("/test-github", methods=["POST"])
@require_db
def test_github(conn):
    """Diagnostic endpoint — fires a test GitHub issue and returns the result."""
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return jsonify({"error": "GITHUB_TOKEN not set in environment"}), 500
    payload = json.dumps({
        "title": "[Test] Origin GitHub integration check",
        "body": "This is an automated test issue from Origin. You can close this.",
        "labels": ["feedback"],
    }).encode()
    url = f"https://api.github.com/repos/{GITHUB_REPO}/issues"
    req = Request(
        url, data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        resp = urlopen(req, timeout=10)
        resp_body = resp.read().decode()
        return jsonify({"status": resp.status, "response": json.loads(resp_body)}), 200
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500
