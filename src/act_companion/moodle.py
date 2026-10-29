"""Minimal Moodle Web Services client for activity.act.edu."""
import requests

try:
    import keyring
    import keyring.errors
except ImportError:  # the Android app ships without keyring; its private storage is only readable by the app
    keyring = None

from . import config

BASE = config.BASE
KEYRING_SERVICE = "activity.act.edu"
KEYRING_NAME = "token"


class MoodleError(Exception):
    pass


class AuthError(MoodleError):
    """The token is missing, expired or revoked. The user must log in again."""


def request_token(username, password, service="moodle_mobile_app"):
    """Exchange username/password for a web service token (same flow as the official Moodle app)."""
    r = requests.post(
        f"{BASE}/login/token.php",
        data={"username": username, "password": password, "service": service},
        timeout=30,
    )
    data = r.json()
    if "token" not in data:
        raise MoodleError(data.get("error", "login failed"))
    return data["token"]


# The token goes in the OS keychain (Credential Manager, Keychain, Secret Service).
# Some Linux setups have no keychain, so fall back to a user-only file in the data dir.
def save_token(token):
    if keyring is None:
        config.write_private(config.TOKEN_FALLBACK_FILE, token)
        return
    try:
        keyring.set_password(KEYRING_SERVICE, KEYRING_NAME, token)
        config.TOKEN_FALLBACK_FILE.unlink(missing_ok=True)
    except keyring.errors.KeyringError:
        config.log("no OS keychain available, storing token in a private file")
        config.write_private(config.TOKEN_FALLBACK_FILE, token)


def load_token():
    try:
        token = keyring and keyring.get_password(KEYRING_SERVICE, KEYRING_NAME)
        if token:
            return token
    except keyring.errors.KeyringError:
        pass
    try:
        return config.TOKEN_FALLBACK_FILE.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def clear_token():
    if keyring is not None:
        try:
            keyring.delete_password(KEYRING_SERVICE, KEYRING_NAME)
        except keyring.errors.KeyringError:
            pass
    config.TOKEN_FALLBACK_FILE.unlink(missing_ok=True)


def _flatten(params, prefix=""):
    """Turn nested lists/dicts into Moodle's courseids[0]=1 style form fields."""
    out = {}
    for k, v in params.items():
        key = f"{prefix}[{k}]" if prefix else k
        if isinstance(v, (list, tuple)):
            v = dict(enumerate(v))
        if isinstance(v, dict):
            out.update(_flatten(v, key))
        else:
            out[key] = v
    return out


def call(function, token=None, **params):
    """Call a Moodle web service function and return the decoded JSON."""
    token = token or load_token()
    if not token:
        raise AuthError("not logged in")
    r = requests.post(
        f"{BASE}/webservice/rest/server.php",
        params={"moodlewsrestformat": "json"},
        data={"wstoken": token, "wsfunction": function, **_flatten(params)},
        timeout=60,
    )
    data = r.json()
    if isinstance(data, dict) and "exception" in data:
        code = data.get("errorcode")
        if code == "invalidtoken":
            raise AuthError(f"{code}: {data.get('message')}")
        raise MoodleError(f"{code}: {data.get('message')}")
    return data
