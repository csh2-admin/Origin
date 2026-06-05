from dotenv import load_dotenv

load_dotenv()

from flask import Flask
from flask_cors import CORS

from .routes import bp

app = Flask(__name__)

CORS(app, supports_credentials=True, origins=["http://localhost:5173"])

app.register_blueprint(bp)
