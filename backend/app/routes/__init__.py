from flask import Blueprint

from .auth import bp as auth_bp
from .asset import bp as asset_bp
from .dashboard import bp as dashboard_bp
from .test_runs import bp as test_runs_bp
from .field_notes import bp as field_notes_bp
from .test_log import bp as test_log_bp
from .actions import bp as actions_bp
from .assembly import bp as assembly_bp
from .feedback import bp as feedback_bp

ALL_BLUEPRINTS = [
    auth_bp,
    asset_bp,
    dashboard_bp,
    test_runs_bp,
    field_notes_bp,
    test_log_bp,
    actions_bp,
    assembly_bp,
    feedback_bp,
]
