"""Local dashboard server.

Keeps the Moodle token server side, exposes a small JSON API to the browser UI, and proxies
file downloads so the token never reaches the page. Binds to 127.0.0.1 only, and every API
call must carry the per-install session cookie, so other local users and websites cannot use it.
"""
import json
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import requests

from . import __version__, autostart, config, moodle, notify, watcher

STATIC = Path(__file__).parent / "static"
ALLOWED_HOSTS = {f"127.0.0.1:{config.PORT}", f"localhost:{config.PORT}"}
ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
COOKIE = "ac_session"
CACHE_TTL = 60
MAX_BODY = 64 * 1024
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
        ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"}

FILE_RE = re.compile(r"https://activity\.act\.edu/(?:webservice/)?pluginfile\.php/[^\"'\s<>)\\]*")

_cache = {}
WATCHER = watcher.Watcher()
STOP = threading.Event()
SESSION_KEY = None
HTTPD = None
# Set by the desktop shell (desktop.py) or the Android app (android.py) so the API can show its window, quit the whole
# app, or reschedule background checks when the settings change.
UI = {"show": None, "quit": None, "settings_saved": None}


def cached(key, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def rewrite_files(obj):
    """Point Moodle file URLs at our proxy so images and downloads work without exposing the token."""
    if isinstance(obj, str):
        return FILE_RE.sub(lambda m: "/api/file?url=" + quote(m.group(0), safe=""), obj)
    if isinstance(obj, list):
        return [rewrite_files(x) for x in obj]
    if isinstance(obj, dict):
        return {k: rewrite_files(v) for k, v in obj.items()}
    return obj


def me():
    return cached("me", lambda: moodle.call("core_webservice_get_site_info"))


def uid():
    return me()["userid"]


class HttpError(Exception):
    def __init__(self, code, msg, **extra):
        super().__init__(msg)
        self.code, self.body = code, {"error": msg, **extra}


# ---- GET routes ---------------------------------------------------------------------------------

def r_ping(m, q):
    return {"app": "act-companion", "version": __version__}


def r_status(m, q):
    s = config.load_settings()
    out = {"version": __version__, "settings": s, "watcher": WATCHER.status, "desktop": UI["show"] is not None,
           "autostart": {"supported": autostart.supported(), "enabled": autostart.is_enabled()},
           "logged_in": False, "user": None}
    if not moodle.load_token():
        return out
    try:
        i = me()
        out.update(logged_in=True, user={"userid": i["userid"], "fullname": i["fullname"], "username": i.get("username"),
                                         "site": i["sitename"]})
    except moodle.AuthError:
        out["expired"] = True
    except (moodle.MoodleError, requests.RequestException, ValueError) as e:
        out.update(logged_in=True, error=f"Could not reach activity.act.edu ({e.__class__.__name__})")
    return out


def r_courses(m, q):
    return cached("courses", lambda: moodle.call("core_enrol_get_users_courses", userid=uid()))


def r_deadlines(m, q):
    since = int(time.time()) - 7 * 86400
    return cached("deadlines", lambda: moodle.call(
        "core_calendar_get_action_events_by_timesort", timesortfrom=since, limitnum=50))


def r_grades(m, q):
    return cached("grades", lambda: moodle.call("gradereport_overview_get_course_grades", userid=uid()))


def r_grade_items(m, q):
    cid = int(m.group(1))
    return cached(f"gi{cid}", lambda: moodle.call("gradereport_user_get_grade_items", courseid=cid, userid=uid()))


def r_course(m, q):
    cid = int(m.group(1))
    if "fresh" in q:
        _cache.pop(f"c{cid}", None)
    return cached(f"c{cid}", lambda: moodle.call("core_course_get_contents", courseid=cid))


def _submission_status(a):
    """Summarize one assignment's submission and grading state for the student."""
    try:
        s = moodle.call("mod_assign_get_submission_status", assignid=a["id"])
    except (moodle.MoodleError, requests.RequestException, ValueError):
        return None
    last = s.get("lastattempt") or {}
    sub = last.get("submission") or last.get("teamsubmission") or {}
    fb = s.get("feedback") or {}
    return {"submission": sub.get("status"), "grading": last.get("gradingstatus"), "grade": fb.get("gradefordisplay")}


def r_assignments(m, q):
    cid = int(m.group(1))

    def fetch():
        data = moodle.call("mod_assign_get_assignments", courseids=[cid])
        assigns = data["courses"][0].get("assignments", []) if data.get("courses") else []
        # One status call per assignment; run them side by side so the tab opens quickly.
        with ThreadPoolExecutor(max_workers=6) as pool:
            for a, st in zip(assigns, pool.map(_submission_status, assigns)):
                a["status"] = st
        return data
    return cached(f"a{cid}", fetch)


def r_forums(m, q):
    cid = int(m.group(1))
    return cached(f"f{cid}", lambda: moodle.call("mod_forum_get_forums_by_courses", courseids=[cid]))


def r_discussions(m, q):
    fid = int(m.group(1))
    return cached(f"d{fid}", lambda: moodle.call("mod_forum_get_forum_discussions", forumid=fid, perpage=30))


def r_posts(m, q):
    did = int(m.group(1))
    return cached(f"p{did}", lambda: moodle.call("mod_forum_get_discussion_posts", discussionid=did))


def r_notifications(m, q):
    return moodle.call("message_popup_get_popup_notifications", useridto=uid())


def r_unread(m, q):
    def fetch():
        n = moodle.call("message_popup_get_unread_popup_notification_count", useridto=uid())
        c = moodle.call("core_message_get_unread_conversations_count", useridto=uid())
        return {"notifications": int(n or 0), "messages": int(c or 0)}
    return cached("unread", fetch)


def r_conversations(m, q):
    return moodle.call("core_message_get_conversations", userid=uid(), limitnum=50, limitfrom=0)


def r_conversation(m, q):
    return moodle.call("core_message_get_conversation_messages",
                       currentuserid=uid(), convid=int(m.group(1)), limitnum=50, newest=1)


def r_recent(m, q):
    """Items the background watcher detected as new, optionally for one course."""
    with watcher.LOCK:
        st = watcher.load_state()
    recent = st.get("recent", [])
    if "course" in q:
        cid = int(q["course"][0])
        recent = [r for r in recent if r.get("course") == cid]
    checked = st.get("checked", {})
    return {"recent": recent, "checked": checked.get(q["course"][0]) if "course" in q else max(checked.values(), default=None)}


GET_ROUTES = [
    (r"^/api/status$", r_status),
    (r"^/api/courses$", r_courses),
    (r"^/api/deadlines$", r_deadlines),
    (r"^/api/grades$", r_grades),
    (r"^/api/grades/(\d+)$", r_grade_items),
    (r"^/api/recent$", r_recent),
    (r"^/api/course/(\d+)$", r_course),
    (r"^/api/assignments/(\d+)$", r_assignments),
    (r"^/api/forums/(\d+)$", r_forums),
    (r"^/api/discussions/(\d+)$", r_discussions),
    (r"^/api/posts/(\d+)$", r_posts),
    (r"^/api/notifications$", r_notifications),
    (r"^/api/unread$", r_unread),
    (r"^/api/conversations$", r_conversations),
    (r"^/api/conversation/(\d+)$", r_conversation),
]


# ---- POST routes --------------------------------------------------------------------------------

def p_login(body):
    username, password = str(body.get("username", "")).strip(), str(body.get("password", ""))
    if not username or not password:
        raise HttpError(400, "Enter your username and password.")
    try:
        token = moodle.request_token(username, password)
    except moodle.MoodleError as e:
        raise HttpError(400, str(e))
    moodle.save_token(token)
    _cache.clear()
    WATCHER.reset()
    WATCHER.wake.set()
    return r_status(None, {})


def p_logout(body):
    moodle.clear_token()
    _cache.clear()
    WATCHER.reset()
    with watcher.LOCK:
        config.STATE_FILE.unlink(missing_ok=True)  # history belongs to the account that logged out
    return {"ok": True}


def p_settings(body):
    s = config.load_settings()
    if "watch_courses" in body:
        w = body["watch_courses"]
        s["watch_courses"] = None if w is None else sorted({int(x) for x in w})
    if "interval_minutes" in body:
        s["interval_minutes"] = min(60, max(1, int(body["interval_minutes"])))
    if "grades_interval_minutes" in body:
        s["grades_interval_minutes"] = min(240, max(5, int(body["grades_interval_minutes"])))
    if isinstance(body.get("alerts"), dict):
        s["alerts"].update({k: bool(v) for k, v in body["alerts"].items() if k in s["alerts"]})
    if "reminder_hours" in body:
        hours = sorted({float(h) for h in body["reminder_hours"] if 0 < float(h) <= 168}, reverse=True)[:5]
        s["reminder_hours"] = [int(h) if h == int(h) else h for h in hours]
    if "course_order" in body:
        s["course_order"] = [int(x) for x in body["course_order"]][:200]
    if "course_colors" in body:
        s["course_colors"] = {str(int(k)): int(v) for k, v in body["course_colors"].items() if 1 <= int(v) <= 8}
    if "grades_show_value" in body:
        s["grades_show_value"] = bool(body["grades_show_value"])
    config.save_settings(s)
    if UI["settings_saved"]:
        UI["settings_saved"](s)
    WATCHER.wake.set()
    return s


def p_refresh(body):
    _cache.clear()
    return {"ok": True}


def p_mark_one_read(body):
    nid = int(body.get("id", 0))
    if nid <= 0:
        raise HttpError(400, "missing notification id")
    moodle.call("core_message_mark_notification_read", notificationid=nid, timeread=int(time.time()))
    _cache.pop("unread", None)
    return {"ok": True}


def p_mark_read(body):
    moodle.call("core_message_mark_all_notifications_as_read", useridto=uid())
    _cache.pop("unread", None)
    return {"ok": True}


def p_test(body):
    ok = notify.send("ACT Companion", "Test notification. If you can read this, alerts work.")
    return {"ok": ok}


def p_check(body):
    WATCHER.wake.set()
    return {"ok": True}


def p_autostart(body):
    return {"enabled": autostart.set_enabled(bool(body.get("enabled")))}


def p_quit(body):
    threading.Thread(target=UI["quit"] or shutdown, daemon=True).start()
    return {"ok": True}


def p_show(body):
    """A second launch of the app asks the running one to bring its window to the front."""
    if not UI["show"]:
        return {"ok": False}
    threading.Thread(target=UI["show"], daemon=True).start()
    return {"ok": True}


POST_ROUTES = {"/api/login": p_login, "/api/logout": p_logout, "/api/settings": p_settings,
               "/api/test-notification": p_test, "/api/check-now": p_check,
               "/api/autostart": p_autostart, "/api/quit": p_quit, "/api/notifications/read": p_mark_read,
               "/api/notification/read": p_mark_one_read,
               "/api/refresh": p_refresh, "/api/show": p_show}


# ---- HTTP handler -------------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "ACTCompanion"

    def log_message(self, fmt, *args):
        pass  # no request logging; pythonw has no console and URLs can carry the session key

    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, data):
        self._send(code, json.dumps(rewrite_files(data)).encode())

    def _has_session(self):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return False
        return COOKIE in c and secrets.compare_digest(c[COOKIE].value, SESSION_KEY)

    def _guard(self):
        """Reject DNS rebinding (wrong Host) and anything without our session cookie."""
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            self._send(403, b"forbidden", "text/plain")
            return False
        return True

    def do_GET(self):
        if not self._guard():
            return
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)

        if path == "/api/ping":
            return self._json(200, r_ping(None, query))
        if path == "/" and "key" in query:
            if secrets.compare_digest(query["key"][0], SESSION_KEY):
                cookie = f"{COOKIE}={SESSION_KEY}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"
                return self._send(303, b"", "text/plain", {"Location": "/", "Set-Cookie": cookie})
            return self._send(303, b"", "text/plain", {"Location": "/"})
        if path.startswith("/api/"):
            if not self._has_session():
                return self._json(401, {"error": "Open ACT Companion from its shortcut or the act-companion command."})
            if path == "/api/file":
                return self._file(query.get("url", [""])[0])
            for pattern, fn in GET_ROUTES:
                m = re.match(pattern, path)
                if m:
                    return self._call(fn, m, query)
            return self._json(404, {"error": "unknown route"})

        name = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (STATIC / name).resolve()
        if STATIC.resolve() not in f.parents or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        self._send(200, f.read_bytes(), MIME.get(f.suffix, "application/octet-stream"),
                   # No inline scripts: Moodle content can never execute even if it slipped past escaping.
                   {"Content-Security-Policy": "default-src 'self'; script-src 'self'; "
                    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"}
                   if f.suffix == ".html" else None)

    def do_POST(self):
        if not self._guard():
            return
        origin = self.headers.get("Origin")
        if (origin and origin not in ORIGINS) or not self._has_session():
            return self._json(403, {"error": "forbidden"})
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self._json(415, {"error": "expected JSON"})
        fn = POST_ROUTES.get(urlparse(self.path).path)
        if not fn:
            return self._json(404, {"error": "unknown route"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._json(413, {"error": "too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json(400, {"error": "bad JSON"})
        self._call(lambda m, q: fn(body), None, {})

    def _call(self, fn, m, q):
        try:
            return self._json(200, fn(m, q))
        except HttpError as e:
            return self._json(e.code, e.body)
        except moodle.AuthError:
            return self._json(401, {"error": "Please log in again.", "auth": True})
        except moodle.MoodleError as e:
            return self._json(502, {"error": str(e)})
        except requests.RequestException as e:
            return self._json(502, {"error": f"Could not reach activity.act.edu ({e.__class__.__name__})"})
        except (TypeError, ValueError) as e:
            return self._json(400, {"error": f"bad request: {e}"})

    def _file(self, src):
        p = urlparse(src)
        if p.scheme != "https" or p.netloc != "activity.act.edu" or "pluginfile.php/" not in p.path:
            return self._send(400, b"bad file url", "text/plain")
        path = p.path if "/webservice/" in p.path else p.path.replace("/pluginfile.php/", "/webservice/pluginfile.php/", 1)
        params = {k: v[0] for k, v in parse_qs(p.query).items()}
        params["token"] = moodle.load_token()
        try:
            r = requests.get(config.BASE + path, params=params, timeout=60, allow_redirects=False)
        except requests.RequestException:
            return self._send(502, b"upstream error", "text/plain")
        if r.status_code != 200:
            return self._send(r.status_code if r.status_code < 500 else 502, b"file unavailable", "text/plain")
        ctype = r.headers.get("Content-Type", "application/octet-stream")
        extra = {}
        if r.headers.get("Content-Disposition"):
            extra["Content-Disposition"] = r.headers["Content-Disposition"]
        # Never let a served file run as a page on our origin.
        if "html" in ctype or "svg" in ctype or "javascript" in ctype or "xml" in ctype:
            ctype = "application/octet-stream"
            extra["Content-Disposition"] = "attachment"
        self._send(200, r.content, ctype, extra)


def shutdown():
    STOP.set()
    WATCHER.wake.set()
    if HTTPD:
        HTTPD.shutdown()


def ping():
    """True if an ACT Companion is already answering on our port."""
    try:
        r = requests.get(f"http://{config.HOST}:{config.PORT}/api/ping", timeout=2)
        return r.json().get("app") == "act-companion"
    except (requests.RequestException, ValueError):
        return False


def app_url():
    return f"http://{config.HOST}:{config.PORT}/?key={config.session_key()}"


def start(watch=True):
    """Bind the port and start the background watcher. Returns False if the port is taken.

    watch=False (Android) runs checks only when woken, because the app schedules the regular ones itself.
    """
    global SESSION_KEY, HTTPD
    config.ensure_dir()
    SESSION_KEY = config.session_key()
    try:
        HTTPD = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    except OSError:
        return False
    loop = WATCHER.run_forever if watch else WATCHER.run_on_wake
    threading.Thread(target=loop, args=(STOP,), daemon=True, name="watcher").start()
    return True


def start_background(watch=True):
    """Start the dashboard server on its own thread (used by the app window). Returns False if the port is taken."""
    if not start(watch):
        return False
    threading.Thread(target=HTTPD.serve_forever, daemon=True, name="http").start()
    return True


def serve(on_ready=None):
    """Run the dashboard and the background watcher until quit (browser mode). Returns False if the port is taken."""
    if not start():
        return False
    if on_ready:
        on_ready()
    try:
        HTTPD.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()
        WATCHER.wake.set()
        HTTPD.server_close()
    return True
