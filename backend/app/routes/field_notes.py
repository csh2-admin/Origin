import json
import logging
import os
import uuid

from flask import Blueprint, current_app, jsonify, request

from ..database import require_db, _dict_row, _dict_rows
from ._helpers import _serialize

logger = logging.getLogger(__name__)

bp = Blueprint("field_notes", __name__)


# ── Engineers ──

@bp.route("/memos/engineers")
@require_db
def list_engineers(conn):
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT engineer FROM memo_log ORDER BY engineer")
    return jsonify([r[0] for r in cur.fetchall()])


# ── Field Notes ──

@bp.route("/field-notes", methods=["POST"])
@require_db
def create_field_note(conn):
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
        LIMIT 500
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


# ── Hypotheses ──

@bp.route("/hypotheses", methods=["POST"])
@require_db
def create_hypothesis(conn):
    note = request.form.get("note", "").strip()
    engineer = request.form.get("engineer", "")
    if not note:
        return jsonify({"detail": "Hypothesis text is required"}), 400

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
        (engineer, "Hypothesis", "Unprocessed", note[:200] if len(note) > 200 else note, note, "None", photo_url),
    )
    row = _dict_row(cur)
    conn.commit()
    return jsonify(_serialize(row)), 201


@bp.route("/hypotheses", methods=["GET"])
@require_db
def list_hypotheses(conn):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, logged_at, engineer, activity_type, summary, raw_transcript, audio_url
        FROM memo_log
        WHERE source_file = 'Hypothesis'
        ORDER BY logged_at DESC
        LIMIT 200
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
        logger.warning("Could not fetch reply counts for hypotheses")
        for r in rows:
            r["reply_count"] = 0
    return jsonify(rows)


# ── Replies ──

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
