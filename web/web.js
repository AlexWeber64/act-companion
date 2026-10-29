// ACT Companion as a web app (iPhone home screen, or any browser). There is no local server here: this file answers the
// UI's /api/* requests in the page itself by calling activity.act.edu directly, the way the official Moodle app does.
// It mirrors src/act_companion/server.py. The token stays in this browser's storage; no other server ever sees it.
"use strict";
(() => {
  const VERSION = "__VERSION__"; // filled in by web/build.py
  const BASE = "https://activity.act.edu";
  const CACHE_TTL = 60 * 1000;
  const FILE_RE = /https:\/\/activity\.act\.edu\/(?:webservice\/)?pluginfile\.php\/[^"'\s<>)\\]*/g;
  const DEFAULTS = {
    watch_courses: null, interval_minutes: 5, grades_interval_minutes: 15,
    alerts: {content: false, deadlines: true, grades: true}, reminder_hours: [24, 1],
    grades_show_value: false, course_order: [], course_colors: {},
  };

  // ---- storage ------------------------------------------------------------------------------------

  const store = {
    get(k) { try { return localStorage.getItem("ac." + k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem("ac." + k) : localStorage.setItem("ac." + k, v); } catch (e) { /* private mode */ } },
  };
  const token = () => store.get("token");

  function loadSettings() {
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    let saved = {};
    try { saved = JSON.parse(store.get("settings") || "{}"); } catch (e) { /* start fresh */ }
    for (const [k, v] of Object.entries(saved)) {
      if (k === "alerts" && v && typeof v === "object") {
        for (const [a, b] of Object.entries(v)) if (a in s.alerts) s.alerts[a] = !!b;
      } else if (k in s) s[k] = v;
    }
    return s;
  }

  // ---- Moodle ------------------------------------------------------------------------------------

  class MoodleError extends Error {}
  class AuthError extends MoodleError {}
  class HttpError extends Error {
    constructor(code, msg) { super(msg); this.code = code; }
  }

  // Nested lists and objects become Moodle's courseids[0]=1 style form fields.
  function flatten(params, prefix = "", out = new URLSearchParams()) {
    for (const [k, v] of Object.entries(params)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === "object") flatten(v, key, out);
      else out.append(key, String(v));
    }
    return out;
  }

  async function post(url, form) {
    let r;
    try {
      r = await fetch(url, {method: "POST", body: form, credentials: "omit", referrerPolicy: "no-referrer"});
    } catch (e) {
      throw new HttpError(502, "Could not reach activity.act.edu (network error)");
    }
    try { return await r.json(); } catch (e) { throw new HttpError(502, `activity.act.edu sent an unexpected reply (HTTP ${r.status})`); }
  }

  async function call(fn, params = {}) {
    const t = token();
    if (!t) throw new AuthError("not logged in");
    const form = flatten(params);
    form.set("wstoken", t);
    form.set("wsfunction", fn);
    const data = await post(`${BASE}/webservice/rest/server.php?moodlewsrestformat=json`, form);
    if (data && typeof data === "object" && !Array.isArray(data) && "exception" in data) {
      if (data.errorcode === "invalidtoken") throw new AuthError(`${data.errorcode}: ${data.message}`);
      throw new MoodleError(`${data.errorcode}: ${data.message}`);
    }
    return data;
  }

  let cache = new Map();
  async function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
    const value = await fn();
    cache.set(key, {at: Date.now(), value});
    return value;
  }

  // Course files and images need the token, which a link or <img> can only carry in the URL (as the Moodle app does).
  // The request goes only to activity.act.edu, and the page sends no Referer anywhere.
  function fileUrl(u) {
    const url = u.replace("/pluginfile.php/", "/webservice/pluginfile.php/").replace("/webservice/webservice/", "/webservice/");
    return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token() || "");
  }
  function rewriteFiles(v) {
    if (typeof v === "string") return v.replace(FILE_RE, fileUrl);
    if (Array.isArray(v)) return v.map(rewriteFiles);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = rewriteFiles(x);
      return out;
    }
    return v;
  }

  const me = () => cached("me", () => call("core_webservice_get_site_info"));
  const uid = async () => (await me()).userid;

  // Runs fn over items, at most `limit` at a time.
  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
    return out;
  }

  async function submissionStatus(a) {
    try {
      const s = await call("mod_assign_get_submission_status", {assignid: a.id});
      const last = s.lastattempt || {};
      const sub = last.submission || last.teamsubmission || {};
      return {submission: sub.status, grading: last.gradingstatus, grade: (s.feedback || {}).gradefordisplay};
    } catch (e) {
      return null;
    }
  }

  // ---- routes (the same as server.py) -----------------------------------------------------------

  async function status() {
    const out = {version: VERSION, settings: loadSettings(), watcher: null, desktop: false,
      autostart: {supported: false, enabled: false}, logged_in: false, user: null};
    if (!token()) return out;
    try {
      const i = await me();
      out.logged_in = true;
      out.user = {userid: i.userid, fullname: i.fullname, username: i.username, site: i.sitename};
    } catch (e) {
      if (e instanceof AuthError) out.expired = true;
      else { out.logged_in = true; out.error = e.message; }
    }
    return out;
  }

  const GET = [
    [/^\/api\/ping$/, () => ({app: "act-companion", version: VERSION})],
    [/^\/api\/status$/, status],
    [/^\/api\/courses$/, async () => cached("courses", async () => call("core_enrol_get_users_courses", {userid: await uid()}))],
    [/^\/api\/deadlines$/, () => cached("deadlines", () => call("core_calendar_get_action_events_by_timesort",
      {timesortfrom: Math.floor(Date.now() / 1000) - 7 * 86400, limitnum: 50}))],
    [/^\/api\/grades$/, () => cached("grades", async () => call("gradereport_overview_get_course_grades", {userid: await uid()}))],
    [/^\/api\/grades\/(\d+)$/, (m) => cached("gi" + m[1], async () => call("gradereport_user_get_grade_items", {courseid: +m[1], userid: await uid()}))],
    [/^\/api\/recent$/, () => ({recent: [], checked: null})], // course-change watching needs the desktop or Android app
    [/^\/api\/course\/(\d+)$/, (m, q) => {
      if (q.has("fresh")) cache.delete("c" + m[1]);
      return cached("c" + m[1], () => call("core_course_get_contents", {courseid: +m[1]}));
    }],
    [/^\/api\/assignments\/(\d+)$/, (m) => cached("a" + m[1], async () => {
      const data = await call("mod_assign_get_assignments", {courseids: [+m[1]]});
      const assigns = (data.courses && data.courses[0] && data.courses[0].assignments) || [];
      const sts = await pool(assigns, 6, submissionStatus);
      assigns.forEach((a, i) => { a.status = sts[i]; });
      return data;
    })],
    [/^\/api\/forums\/(\d+)$/, (m) => cached("f" + m[1], () => call("mod_forum_get_forums_by_courses", {courseids: [+m[1]]}))],
    [/^\/api\/discussions\/(\d+)$/, (m) => cached("d" + m[1], () => call("mod_forum_get_forum_discussions", {forumid: +m[1], perpage: 30}))],
    [/^\/api\/posts\/(\d+)$/, (m) => cached("p" + m[1], () => call("mod_forum_get_discussion_posts", {discussionid: +m[1]}))],
    [/^\/api\/notifications$/, async () => call("message_popup_get_popup_notifications", {useridto: await uid()})],
    [/^\/api\/unread$/, () => cached("unread", async () => {
      const id = await uid();
      const [n, c] = await Promise.all([call("message_popup_get_unread_popup_notification_count", {useridto: id}),
        call("core_message_get_unread_conversations_count", {useridto: id})]);
      return {notifications: Number(n || 0), messages: Number(c || 0)};
    })],
    [/^\/api\/conversations$/, async () => call("core_message_get_conversations", {userid: await uid(), limitnum: 50, limitfrom: 0})],
    [/^\/api\/conversation\/(\d+)$/, async (m) => call("core_message_get_conversation_messages",
      {currentuserid: await uid(), convid: +m[1], limitnum: 50, newest: 1})],
  ];

  const POST = {
    "/api/login": async (body) => {
      const username = String(body.username || "").trim(), password = String(body.password || "");
      if (!username || !password) throw new HttpError(400, "Enter your username and password.");
      const data = await post(`${BASE}/login/token.php`, new URLSearchParams({username, password, service: "moodle_mobile_app"}));
      if (!data.token) throw new HttpError(400, data.error || "login failed");
      store.set("token", data.token);
      cache = new Map();
      return status();
    },
    "/api/logout": () => {
      store.set("token", null);
      cache = new Map();
      return {ok: true};
    },
    "/api/settings": (body) => {
      const s = loadSettings();
      const int = (x) => { const n = Math.trunc(Number(x)); if (!Number.isFinite(n)) throw new HttpError(400, "bad request"); return n; };
      if ("watch_courses" in body) s.watch_courses = body.watch_courses === null ? null : [...new Set(body.watch_courses.map(int))].sort((a, b) => a - b);
      if ("interval_minutes" in body) s.interval_minutes = Math.min(60, Math.max(1, int(body.interval_minutes)));
      if ("grades_interval_minutes" in body) s.grades_interval_minutes = Math.min(240, Math.max(5, int(body.grades_interval_minutes)));
      if (body.alerts && typeof body.alerts === "object") for (const [k, v] of Object.entries(body.alerts)) if (k in s.alerts) s.alerts[k] = !!v;
      if ("reminder_hours" in body) {
        s.reminder_hours = [...new Set(body.reminder_hours.map(Number).filter((h) => h > 0 && h <= 168))].sort((a, b) => b - a).slice(0, 5);
      }
      if ("course_order" in body) s.course_order = body.course_order.map(int).slice(0, 200);
      if ("course_colors" in body) {
        s.course_colors = {};
        for (const [k, v] of Object.entries(body.course_colors)) if (int(v) >= 1 && int(v) <= 8) s.course_colors[String(int(k))] = int(v);
      }
      if ("grades_show_value" in body) s.grades_show_value = !!body.grades_show_value;
      store.set("settings", JSON.stringify(s));
      return s;
    },
    "/api/refresh": () => { cache = new Map(); return {ok: true}; },
    "/api/check-now": () => ({ok: true}),
    "/api/test-notification": () => ({ok: false}),
    "/api/notifications/read": async () => {
      await call("core_message_mark_all_notifications_as_read", {useridto: await uid()});
      cache.delete("unread");
      return {ok: true};
    },
    "/api/notification/read": async (body) => {
      const id = Math.trunc(Number(body.id || 0));
      if (!(id > 0)) throw new HttpError(400, "missing notification id");
      await call("core_message_mark_notification_read", {notificationid: id, timeread: Math.floor(Date.now() / 1000)});
      cache.delete("unread");
      return {ok: true};
    },
  };

  const reply = (code, data) => new Response(JSON.stringify(rewriteFiles(data)), {status: code, headers: {"Content-Type": "application/json"}});

  // Same contract as the local server: JSON in, JSON out, 401 {auth: true} when the token is no longer valid.
  async function apiFetch(path, opt = {}) {
    const url = new URL(path, location.href);
    try {
      if ((opt.method || "GET") === "POST") {
        const fn = POST[url.pathname.replace(/^.*?\/api\//, "/api/")];
        if (!fn) return reply(404, {error: "unknown route"});
        return reply(200, await fn(JSON.parse(opt.body || "{}")));
      }
      const p = url.pathname.replace(/^.*?\/api\//, "/api/");
      for (const [re, fn] of GET) {
        const m = p.match(re);
        if (m) return reply(200, await fn(m, url.searchParams));
      }
      return reply(404, {error: "unknown route"});
    } catch (e) {
      if (e instanceof HttpError) return reply(e.code, {error: e.message});
      if (e instanceof AuthError) return reply(401, {error: "Please log in again.", auth: true});
      if (e instanceof MoodleError) return reply(502, {error: e.message});
      return reply(400, {error: "bad request: " + e.message});
    }
  }

  window.ACTWeb = {fetch: apiFetch};

  // A download link to another site cannot use the download attribute, so open course files in a new tab instead of
  // navigating away from the app.
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("a[download]");
    if (a && a.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  }, true);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* works without it */ });
})();
