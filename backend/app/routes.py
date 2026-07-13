import io
import os
import uuid
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, make_response, request
from PIL import Image
from pillow_heif import register_heif_opener

from .database import create_session, delete_session, require_db, _dict_row, _dict_rows

register_heif_opener()

bp = Blueprint("api", __name__)

MAX_DIMENSION = 1920
JPEG_QUALITY = 85

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"}


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


@bp.route("/parts-catalog")
@require_db
def parts_catalog(conn):
    position = request.args.get("position")
    cur = conn.cursor()
    if position:
        cur.execute(
            "SELECT part_number, position, description FROM parts_catalog WHERE position = %s ORDER BY part_number",
            (position,),
        )
    else:
        cur.execute("SELECT part_number, position, description FROM parts_catalog ORDER BY position, part_number")
    return jsonify([_serialize(r) for r in _dict_rows(cur)])


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


@bp.route("/usage")
@require_db
def get_all_usage(conn):
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
            }
        except Exception as exc:
            import traceback
            traceback.print_exc()
            results[position] = {"est_cycles": 0, "runtime_hours": 0, "_error": str(exc)}

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
