import json
import logging
import os
from datetime import date, datetime
from urllib.request import Request, urlopen

from PIL import Image
from pillow_heif import register_heif_opener

register_heif_opener()

logger = logging.getLogger(__name__)

MAX_DIMENSION = 1920
JPEG_QUALITY = 85
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"}

GITHUB_REPO = "csh2-admin/Origin"

ADMIN_USERS = {"engineer1", "edwardyoun", "anthonyku", "jimmyli"}

EXEMPT_POSITIONS = {"inline_dcv"}


def _serialize(row):
    return {
        k: (v.isoformat() if isinstance(v, (datetime, date)) else v)
        for k, v in row.items()
    }


def _dict_row_from(description, row):
    cols = [d[0] for d in description]
    return dict(zip(cols, row))


def _parse_ts(val):
    if not val:
        return None
    s = str(val).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


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
