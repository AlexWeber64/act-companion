"""Background checks: new or unhidden course content, deadlines, and grades.

Each check records what it has seen in state.json. The first pass for a course only records
(a "baseline") so nobody is flooded with alerts for everything that already exists.
"""
import json
import threading
import time

import requests

from . import config, moodle, notify

LOCK = threading.RLock()  # guards state.json between the watcher thread and the web server
SKIP_MODS = {"label"}  # text-only blocks, nothing to download
RECENT_KEEP_SECONDS = 14 * 86400
RECENT_MAX = 100
MAX_BACKOFF_SECONDS = 30 * 60


def load_state():
    try:
        return json.loads(config.STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state):
    config.write_private(config.STATE_FILE, json.dumps(state))


def short_name(course):
    """'CSC 192_VICTORATOS_2627FALL-V' -> 'CSC 192'."""
    return (course.get("shortname") or "").split("_")[0].strip() or course.get("fullname") or "Course"


def fmt_time(ts):
    return time.strftime("%a %d %b, %H:%M", time.localtime(ts))


def fmt_left(seconds):
    if seconds >= 5400:
        return f"{round(seconds / 3600)} hours"
    if seconds >= 3600:
        return "1 hour"
    return f"{max(1, round(seconds / 60))} minutes"


# ---- course content ---------------------------------------------------------------------------

def scan_course(course_id):
    """Return {key: item} for everything currently visible to this user in the course."""
    found = {}
    for sec in moodle.call("core_course_get_contents", courseid=course_id):
        for m in sec.get("modules", []):
            if m.get("modname") in SKIP_MODS or m.get("uservisible") is False:
                continue
            url = m.get("url") or f"{config.BASE}/course/view.php?id={course_id}"
            mkey = f"m{m['id']}"
            found[mkey] = {"label": m["name"], "url": url, "ver": 0, "kind": "resource"}
            for f in m.get("contents") or []:
                if f.get("type") != "file":
                    continue
                key = f"f{m['id']}/{f.get('filepath', '/')}{f['filename']}"
                found[key] = {"label": f["filename"], "url": url, "ver": f.get("timemodified", 0),
                              "kind": "file", "module": mkey, "fileurl": f.get("fileurl")}
                found[mkey].setdefault("fileurl", f.get("fileurl"))
                # A module's ver is its newest file's upload time, used to tell "uploaded earlier, now unhidden" from "just uploaded".
                found[mkey]["ver"] = max(found[mkey]["ver"], f.get("timemodified", 0))

    for forum in moodle.call("mod_forum_get_forums_by_courses", courseids=[course_id]):
        disc = moodle.call("mod_forum_get_forum_discussions", forumid=forum["id"], perpage=30)
        for d in disc.get("discussions", []):
            did = d["discussion"]
            found[f"d{did}"] = {"label": f"{forum['name']}: {d['name']}", "ver": d.get("timemodified", 0),
                                "url": f"{config.BASE}/mod/forum/discuss.php?d={did}", "kind": "discussion"}
    return found


def scan_attachments(found, old):
    """Fetch posts only for discussions that are new or changed, and collect their attachments."""
    for key, item in list(found.items()):
        if item["kind"] != "discussion":
            continue
        if old is not None and old.get(key, {}).get("ver") == item["ver"]:
            continue
        posts = moodle.call("mod_forum_get_discussion_posts", discussionid=int(key[1:])).get("posts", [])
        for p in posts:
            for a in p.get("attachments") or []:
                found[f"a{p['id']}/{a['filename']}"] = {
                    "label": a["filename"], "url": item["url"], "ver": a.get("timemodified", 0),
                    "kind": "attachment", "fileurl": a.get("fileurl")}
    # Attachments of discussions we did not re-fetch are unchanged; keep them so they are not "new" next time.
    if old is not None:
        for k, v in old.items():
            if k.startswith("a") and k not in found:
                found[k] = v


def check_content(cid, cname, st, out):
    items = st.setdefault("items", {})
    checked = st.setdefault("checked", {})
    old = items.get(str(cid))
    found = scan_course(cid)
    scan_attachments(found, old)
    now = time.time()
    if old is None:
        items[str(cid)], checked[str(cid)] = found, now
        return
    last_check = checked.get(str(cid)) or now - 600
    new_modules = {k for k in found if k.startswith("m") and k not in old}
    for key, item in found.items():
        kind = item["kind"]
        if key in old:
            if kind in ("file", "attachment") and item["ver"] > old[key].get("ver", 0):
                title = "Updated file"
            else:
                continue
        elif kind == "discussion":
            title = "New post"
        elif kind == "file" and item.get("module") in new_modules:
            continue  # announced together with its new module
        else:
            # Uploaded before our previous check but only visible now means it was hidden and got unhidden.
            was_hidden = item["ver"] and item["ver"] < last_check - 120
            title = ("Now visible: " if was_hidden else "New ") + kind
        out.append((f"{cname}: {title}", item["label"], item["url"]))
        st.setdefault("recent", []).insert(0, {
            "course": cid, "title": title, "label": item["label"], "url": item["url"],
            "fileurl": item.get("fileurl"), "detected": now})
    items[str(cid)], checked[str(cid)] = found, now


# ---- deadlines -------------------------------------------------------------------------------

def check_deadlines(courses, st, out, settings):
    now = time.time()
    events = moodle.call("core_calendar_get_action_events_by_timesort",
                         timesortfrom=int(now) - 3600, timesortto=int(now) + 60 * 86400,
                         limitnum=50).get("events", [])
    first = "events" not in st
    known = st.get("events", {})
    hours = sorted(h for h in settings.get("reminder_hours", []) if h > 0)
    seen = {}
    for e in events:
        cid = (e.get("course") or {}).get("id")
        if cid not in courses:
            continue
        if (e.get("action") or {}).get("actionable") is False:
            continue  # already submitted or otherwise done
        eid, due = str(e["id"]), e["timesort"]
        cname = short_name(courses[cid])
        rec = dict(known.get(eid) or {"reminded": []})
        url = e.get("url") or f"{config.BASE}/course/view.php?id={cid}"
        left = due - now
        crossed = [h for h in hours if 0 < left <= h * 3600 and h not in rec["reminded"]]
        is_new = eid not in known and not first
        if is_new and crossed:
            out.append((f"{cname}: New deadline, due in {fmt_left(left)}", e["name"], url))
        elif is_new:
            out.append((f"{cname}: New deadline", f"{e['name']} (due {fmt_time(due)})", url))
        elif crossed:  # one reminder even if several thresholds passed while the computer was off
            out.append((f"{cname}: Due in {fmt_left(left)}", e["name"], url))
        if crossed:
            rec["reminded"] = sorted(set(rec["reminded"]) | {h for h in hours if left <= h * 3600})
        rec.update(name=e["name"], due=due)
        seen[eid] = rec
    st["events"] = seen


# ---- grades ----------------------------------------------------------------------------------

def check_grades(courses, uid, st, out, settings):
    now = time.time()
    if now - st.get("grades_checked", 0) < settings["grades_interval_minutes"] * 60:
        return
    grades = st.setdefault("grades", {})
    based = st.setdefault("grades_baselined", {})
    for cid, course in courses.items():
        r = moodle.call("gradereport_user_get_grade_items", courseid=cid, userid=uid)
        for ug in r.get("usergrades", []):
            for gi in ug.get("gradeitems", []):
                if gi.get("itemtype") in ("course", "category"):
                    continue  # totals move whenever any item is graded
                key = f"{cid}:{gi['id']}"
                val = (gi.get("gradeformatted") or "").strip()
                prev = grades.get(key)
                if based.get(str(cid)) and val not in ("", "-") and val != prev:
                    title = "Grade updated" if prev not in (None, "", "-") else "New grade"
                    body = gi.get("itemname") or "Grade item"
                    if settings.get("grades_show_value"):
                        body += f": {val}"
                    out.append((f"{short_name(course)}: {title}", body,
                                f"{config.BASE}/grade/report/user/index.php?id={cid}"))
                grades[key] = val
        based[str(cid)] = True
    st["grades_checked"] = now


# ---- loop ------------------------------------------------------------------------------------

class Watcher:
    def __init__(self):
        self.wake = threading.Event()
        self.status = {"last_run": None, "last_ok": None, "last_error": None, "next_run": None}
        self.failures = 0
        self._courses = None
        self._courses_at = 0
        self._uid = None
        self._running = threading.Lock()

    def reset(self):
        """Forget cached account data, e.g. after logging in as someone else."""
        self._courses, self._uid = None, None

    def enrolled(self):
        if self._courses is None or time.time() - self._courses_at > 3600:
            self._uid = moodle.call("core_webservice_get_site_info")["userid"]
            self._courses = {c["id"]: c for c in moodle.call("core_enrol_get_users_courses", userid=self._uid)}
            self._courses_at = time.time()
        return self._courses

    def run_once(self):
        """One round of checks. True if it worked, False if it failed, None if another round was already running."""
        if not self._running.acquire(blocking=False):
            return None
        try:
            return self._run_once()
        finally:
            self._running.release()

    def _run_once(self):
        settings = config.load_settings()
        self.status["last_run"] = time.time()
        out = []
        with LOCK:
            st = load_state()
        try:
            enrolled = self.enrolled()
            if st.get("userid") != self._uid:
                st = {"userid": self._uid}  # never mix one account's history with another's
            watch = settings.get("watch_courses")
            courses = {cid: c for cid, c in enrolled.items() if watch is None or cid in watch}
            if settings["alerts"]["content"]:
                for cid, c in courses.items():
                    check_content(cid, short_name(c), st, out)
            if settings["alerts"]["deadlines"]:
                check_deadlines(courses, st, out, settings)
            if settings["alerts"]["grades"]:
                check_grades(courses, self._uid, st, out, settings)
        except moodle.AuthError as e:
            self.status["last_error"] = "Not logged in" if "not logged in" in str(e) else "Login expired"
            with LOCK:
                cur = load_state()
                if not cur.get("auth_alerted") and "not logged in" not in str(e):
                    notify.send("ACT Companion needs you to log in", "Your session expired. Open ACT Companion to log in again.")
                    cur["auth_alerted"] = True
                    save_state(cur)
            return False
        except (moodle.MoodleError, requests.RequestException, ValueError, KeyError) as e:
            self.failures += 1
            self.status["last_error"] = f"{e.__class__.__name__}: {str(e)[:200]}"
            config.log(f"check failed: {self.status['last_error']}")
            return False

        now = time.time()
        st["auth_alerted"] = False
        st["recent"] = [r for r in st.get("recent", []) if now - r["detected"] < RECENT_KEEP_SECONDS][:RECENT_MAX]
        with LOCK:
            save_state(st)
        for title, body, _ in out:
            config.log(f"alert: {title}: {body}")
        notify.send_batch(out)
        self.failures = 0
        self.status.update(last_ok=now, last_error=None)
        return True

    def run_forever(self, stop):
        while not stop.is_set():
            self.run_once()
            wait = config.load_settings()["interval_minutes"] * 60
            if self.failures:  # back off while the site is down or rejecting us
                wait = min(wait * 2 ** self.failures, MAX_BACKOFF_SECONDS)
            self.status["next_run"] = time.time() + wait
            self.wake.wait(wait)
            self.wake.clear()

    def run_on_wake(self, stop):
        """Android: WorkManager schedules the checks, so this thread only runs one when asked (sign in, Check now)."""
        while not stop.is_set():
            self.wake.wait()
            self.wake.clear()
            if not stop.is_set():
                self.run_once()
