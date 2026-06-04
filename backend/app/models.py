from pydantic import BaseModel
from datetime import datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangeRequest(BaseModel):
    position: str
    effective_time: datetime
    removed_part_number: str | None = None
    removed_part_revision: str | None = None
    removed_part_serial: str | None = None
    installed_part_number: str | None = None
    installed_part_revision: str | None = None
    installed_part_serial: str | None = None
    note: str | None = None
