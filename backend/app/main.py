import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from flask import Flask, request, send_from_directory
from flask_cors import CORS

from .routes import bp

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
app.config["UPLOAD_DIR"] = UPLOAD_DIR
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB

CORS(app, supports_credentials=True, origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5179"])

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")

app.register_blueprint(bp, url_prefix="/api")

if os.path.isdir(FRONTEND_DIR):
    @app.route("/")
    def serve_frontend_root():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.errorhandler(404)
    def fallback_to_frontend(e):
        req_path = request.path
        if req_path.startswith("/api/") or req_path.startswith("/uploads/"):
            return e
        file_path = os.path.join(FRONTEND_DIR, req_path.lstrip("/"))
        if os.path.isfile(file_path):
            return send_from_directory(FRONTEND_DIR, req_path.lstrip("/"))
        return send_from_directory(FRONTEND_DIR, "index.html")
