"""Paths, user settings and logging. Everything lives in the per-user data directory."""
import json
import os
import secrets
import sys
import time
from pathlib import Path

import platformdirs

APP = "ACTCompanion"
BASE = "https://activity.act.edu"
HOST, PORT = "127.0.0.1", 8765

DATA = Path(platformdirs.user_data_dir(APP, appauthor=False))
SETTINGS_FILE = DATA / "settings.json"
STATE_FILE = DATA / "state.json"
LOG_FILE = DATA / "act-companion.log"
KEY_FILE = DATA / "session.key"
TOKEN_FALLBACK_FILE = DATA / "token"

DEFAULTS = {
    "watch_courses": None,  # None means every enrolled course
    "interval_minutes": 5,
    "grades_interval_minutes": 15,
    "alerts": {"content": False, "deadlines": True, "grades": True},  # course-change watching is opt-in
    "reminder_hours": [24, 1],
    "grades_show_value": False,  # grades on screen can be seen by anyone nearby
    "course_order": [],  # course ids in the order the user arranged them; empty means Moodle order
    "course_colors": {},  # course id -> palette slot 1 to 8
}


def ensure_dir():
    DATA.mkdir(parents=True, exist_ok=True)


def write_private(path, text):
    """Write atomically, readable only by the current user on macOS and Linux."""
    ensure_dir()
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def load_settings():
    s = json.loads(json.dumps(DEFAULTS))
    try:
        saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return s
    for k, v in saved.items():
        if k == "alerts" and isinstance(v, dict):
            s["alerts"].update({a: bool(b) for a, b in v.items() if a in s["alerts"]})
        elif k in s:
            s[k] = v
    return s


def save_settings(s):
    write_private(SETTINGS_FILE, json.dumps(s, indent=2))


def session_key():
    """Stable random key that the browser must present (as a cookie) to use the local API."""
    try:
        key = KEY_FILE.read_text(encoding="utf-8").strip()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    key = secrets.token_urlsafe(32)
    write_private(KEY_FILE, key)
    return key


def log(msg):
    try:
        ensure_dir()
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > 500_000:
            LOG_FILE.write_text("", encoding="utf-8")
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass
    if sys.stderr:
        sys.stderr.write(msg + "\n")
