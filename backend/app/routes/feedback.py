import json
import os
from urllib.request import Request, urlopen

from flask import Blueprint, jsonify, request

from ..database import require_db, _dict_row, _dict_rows
from ._helpers import GITHUB_REPO, _serialize, _create_github_issue

bp = Blueprint("feedback", __name__)


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
        return jsonify({"error": str(exc)}), 500
