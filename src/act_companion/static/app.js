"use strict";
/* ACT Companion UI. Plain JavaScript, no build step. Markup follows the design export in docs/DESIGN.md and
   uses only classes from companion.css (plus a few from app.css). Runs under a strict CSP, so there are no
   inline scripts or inline event handlers: every interaction goes through the delegated listeners at the end. */

const BASE = "https://activity.act.edu";
const THEMES = [["system", "System"], ["nocturne", "Nocturne"], ["graphite", "Graphite"], ["daylight", "Daylight"], ["paper", "Paper"]];
const COLOR_NAMES = ["Blue", "Coral", "Green", "Amber", "Teal", "Pink", "Lime", "Orange"];

// ---- helpers ----------------------------------------------------------------------------------

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
// DOMParser documents are inert (no script or handler execution), unlike innerHTML on a live element.
const strip = (h) => (new DOMParser().parseFromString(h || "", "text/html").body.textContent || "").trim();
const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;
const ic = (name, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="icons.svg#i-${name}"></use></svg>`;
const brand = () => `<div class="brand"><span class="brand-mark"></span>ACT Companion</div>`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* not persisted */ } },
};

// ---- time ---------------------------------------------------------------------------------------

const nowS = () => Date.now() / 1000;
const dt = (ts) => new Date(ts * 1000);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (ts) => Math.round((startOfDay(dt(ts)) - startOfDay(new Date())) / 86400000);
const fmtHM = (ts) => dt(ts).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
const fmtShortDate = (d) => d.toLocaleDateString([], {weekday: "short", day: "numeric", month: "short"});
const fmtLongDate = (d) => d.toLocaleDateString([], {weekday: "long", day: "numeric", month: "long"});
function dayName(ts, lower = false) {
  const d = dayDiff(ts);
  const name = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : fmtShortDate(dt(ts));
  return lower && Math.abs(d) <= 1 ? name.toLowerCase() : name;
}
const fmtDue = (ts, lower = false) => `${dayName(ts, lower)}, ${fmtHM(ts)}`;
const rtf = new Intl.RelativeTimeFormat(undefined, {numeric: "auto"});
function relTime(ts) {
  const d = ts - nowS(), a = Math.abs(d);
  if (a < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(d / 3600), "hour");
  if (a < 14 * 86400) return rtf.format(Math.round(d / 86400), "day");
  return rtf.format(Math.round(d / (7 * 86400)), "week");
}
function shortWhen(ts) {
  const d = dayDiff(ts);
  if (d === 0) return fmtHM(ts);
  if (d > -7) return dt(ts).toLocaleDateString([], {weekday: "short"});
  return dt(ts).toLocaleDateString([], {day: "numeric", month: "short"});
}
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  return Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

// ---- state and API ----------------------------------------------------------------------------

const S = {status: null, courses: [], moodleOrder: new Map(), color: {}, grades: {}, gradesAt: 0,
  unread: {notifications: 0, messages: 0}, deadlines: null, deadlinesAt: 0};
let routeToken = 0, painted = false, forceFresh = false, recentSig = null;
const stale = (t) => t !== routeToken;

async function api(path, body) {
  const opt = body === undefined ? {} : {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
  const r = await fetch("/api" + path, opt);
  let j = {};
  try { j = await r.json(); } catch (e) { /* non-JSON error page */ }
  if (r.status === 401) {
    const err = new Error(j.error || "unauthorized");
    err.kind = j.auth ? "login" : "session";
    throw err;
  }
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return cleanText(j, "");
}

// Moodle sends plain-text fields (names, subjects, grade strings) with HTML entities such as "&ndash;".
// Decode only those fields, once, so they display correctly after normal escaping. HTML fields
// (post messages, intros, feedback) are left alone and only ever rendered sandboxed or via strip().
const PLAIN_KEYS = new Set(["name", "fullname", "shortname", "displayname", "activityname", "subject", "itemname", "grade",
  "gradeformatted", "rangeformatted", "percentageformatted", "lettergradeformatted", "userfullname", "filename", "label", "sitename"]);
function decodeEntities(s) {
  return s.includes("&") ? (new DOMParser().parseFromString(s, "text/html").documentElement.textContent || "") : s;
}
function cleanText(v, key) {
  if (Array.isArray(v)) return v.map((x) => cleanText(x, key));
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) v[k] = cleanText(v[k], k);
    return v;
  }
  return typeof v === "string" && PLAIN_KEYS.has(key) ? decodeEntities(v) : v;
}

// ---- courses: names, order, colors ------------------------------------------------------------

const courseById = (id) => S.courses.find((c) => c.id === Number(id));
const shortName = (c) => ((c && c.shortname) || "").split("_")[0].trim() || (c && c.fullname) || "Course";
// "Computer Science 192: Object Oriented Programming with Python - FALL 2026 (V)" -> "Object Oriented Programming with Python"
function courseTitle(c) {
  const full = (c && c.fullname) || "";
  return full.replace(/\s+-\s+(FALL|SPRING|SUMMER|WINTER)\b.*$/i, "").replace(/^[^:]{2,60}?\d{2,4}[A-Z]?\s*:\s*/, "") || full;
}
function courseTerm(c) {
  const m = ((c && c.fullname) || "").match(/\b(FALL|SPRING|SUMMER|WINTER)\s+(\d{4})/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + " " + m[2] : "";
}
const cc = (id) => "c" + (S.color[Number(id)] || 1);
const codeSpan = (c) => `<span class="code">${esc(shortName(c))}</span>`;

// User order first (Settings > Courses), then Moodle's order. Saved colors win; others take the next unused slot.
function applyCourseOrder() {
  const s = S.status.settings;
  const pos = new Map((s.course_order || []).map((id, i) => [id, i]));
  const rank = (c) => (pos.has(c.id) ? pos.get(c.id) : 1000 + (S.moodleOrder.get(c.id) || 0));
  S.courses.sort((a, b) => rank(a) - rank(b));
  const saved = s.course_colors || {};
  S.color = {};
  const used = new Set();
  for (const c of S.courses) if (saved[c.id]) { S.color[c.id] = saved[c.id]; used.add(saved[c.id]); }
  let i = 0;
  for (const c of S.courses) {
    if (S.color[c.id]) continue;
    let slot = [1, 2, 3, 4, 5, 6, 7, 8].find((k) => !used.has(k));
    if (!slot) slot = (i % 8) + 1;
    S.color[c.id] = slot;
    used.add(slot);
    i++;
  }
}

// ---- data loaders (lightly cached on the client) ---------------------------------------------

async function getDeadlines(force = false) {
  if (!force && S.deadlines && Date.now() - S.deadlinesAt < 60000) return S.deadlines;
  const r = await api("/deadlines");
  S.deadlines = (r.events || []).slice().sort((a, b) => a.timesort - b.timesort);
  S.deadlinesAt = Date.now();
  return S.deadlines;
}
async function getGrades(force = false) {
  if (!force && S.gradesAt && Date.now() - S.gradesAt < 60000) return S.grades;
  const r = await api("/grades");
  S.grades = {};
  for (const g of r.grades || []) S.grades[g.courseid] = g.grade;
  S.gradesAt = Date.now();
  return S.grades;
}
async function refreshUnread() {
  try { S.unread = await api("/unread"); renderCounts(); } catch (e) { /* keep the last counts */ }
  return S.unread;
}
const isOpenDeadline = (e) => !(e.action && e.action.actionable === false);
const hasGrade = (g) => g !== undefined && g !== null && String(g).trim() !== "" && String(g).trim() !== "-";
const gradeHtml = (g, big = false) => hasGrade(g) ? `<span class="${big ? "grade-big" : "grade"}">${esc(g)}</span>` : `<span class="grade-none">Not graded yet</span>`;
const contentAlertsOn = () => !!(S.status && S.status.settings.alerts.content);

// ---- painting, loading, errors, toasts -------------------------------------------------------

const vp = () => $("#vp");
function setMain(cls) { $("#view").className = cls; }
function setTitle(title) { document.title = title + " · ACT Companion"; }
function paint(t, html) {
  if (stale(t)) return false;
  painted = true;
  $("#view").innerHTML = html;
  return true;
}
// Skeletons only appear if loading takes longer than 300 ms, so fast pages do not flash.
function loading(t, html) { setTimeout(() => { if (!stale(t) && !painted) $("#view").innerHTML = html; }, 300); }
const sk = (w, h, extra = "") => `<span class="skel" style="width:${w};${h ? `height:${h};` : ""}${extra}"></span>`;
const skelRows = (n, cls = "list-row") => Array.from({length: n}, () => `<div class="row ${cls}"><div style="display:flex;flex-direction:column;gap:8px;">${sk("70%")}${sk("40%", "10px")}</div>${sk("60px", "20px")}</div>`).join("");
const skelPage = (title) => `<header class="page-head"><h1 class="page-title">${esc(title)}</h1></header><div class="block">${skelRows(6)}</div>`;

function errorBox(e) {
  return `<div class="error-box" role="alert"><div class="empty-title">${/reach|network|HTTP 5/i.test(e.message) ? "Couldn't reach activity.act.edu" : "Something went wrong"}</div>
    <p class="empty-text">${esc(e.message)}</p>
    <button class="btn btn-primary" type="button" data-action="retry">${ic("retry", "icon-sm")}Retry now</button></div>`;
}
function emptyState(title, text, action = "", mark = true) {
  return `<div class="empty">${mark ? `<span class="empty-mark">${ic("check")}</span>` : ""}<div class="empty-title">${esc(title)}</div>
    ${text ? `<p class="empty-text">${esc(text)}</p>` : ""}${action}</div>`;
}

function toast(msg, opts = {}) {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; box.id = "toasts"; box.setAttribute("aria-live", "polite"); vp().append(box); }
  const el = document.createElement("div");
  el.className = "toast" + (opts.error ? " is-error" : "");
  el.innerHTML = `${ic(opts.error ? "warning" : opts.icon || "check")}<span>${esc(msg)}</span>
    ${opts.retry ? '<button class="btn btn-ghost" type="button" data-toast-retry style="margin-left:auto;">Retry</button>' : ""}
    <button class="btn btn-icon" type="button" aria-label="Dismiss" data-toast-close ${opts.retry ? 'style="margin-left:0;"' : ""}>${ic("x", "icon-sm")}</button>`;
  if (opts.retry) $("[data-toast-retry]", el).addEventListener("click", () => { el.remove(); opts.retry(); });
  $("[data-toast-close]", el).addEventListener("click", () => el.remove());
  box.prepend(el); // newest on top
  while (box.children.length > 3) box.lastElementChild.remove();
  if (!opts.error) setTimeout(() => el.remove(), 3000);
}

// Moodle-provided HTML is rendered in a sandboxed iframe with scripts disabled, never injected into the page.
function postFrame(html) {
  const f = document.createElement("iframe");
  f.className = "post-frame";
  f.title = "Post";
  f.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const scheme = css.colorScheme && css.colorScheme !== "normal" ? css.colorScheme : "light";
  f.srcdoc = `<base target="_blank"><meta name="color-scheme" content="${scheme}"><style>:root{color-scheme:${scheme}}@font-face{font-family:Inter;src:url("/fonts/InterVariable.woff2") format("woff2");font-weight:100 900}
    body{margin:0;padding:14px 16px;font:14px/1.55 Inter,system-ui,"Segoe UI",sans-serif;color:${v("--color-text-2")};background:transparent;overflow-wrap:anywhere}
    a{color:${v("--color-accent-text")}}img{max-width:100%;height:auto}p:first-child{margin-top:0}p:last-child{margin-bottom:0}
    pre,code{font-family:ui-monospace,Consolas,monospace;font-size:13px;white-space:pre-wrap}</style>${html || ""}`;
  f.addEventListener("load", () => { f.style.height = (f.contentDocument.documentElement.scrollHeight + 2) + "px"; });
  return f;
}

// ---- shell -------------------------------------------------------------------------------------

const NAV = [
  {key: "", href: "#/", label: "Home", icon: "house"},
  {key: "planner", href: "#/planner", label: "Planner", icon: "planner"},
  {key: "deadlines", href: "#/deadlines", label: "Deadlines", icon: "clock", count: "overdue"},
  {key: "courses", href: "#/courses", label: "Courses", icon: "book"},
  {key: "grades", href: "#/grades", label: "Grades", icon: "chart"},
  {key: "messages", href: "#/messages", label: "Messages", icon: "chat", count: "messages"},
  {key: "notifications", href: "#/notifications", label: "Notifications", icon: "bell", count: "notifications"},
  {key: "settings", href: "#/settings", label: "Settings", icon: "sliders"},
];
const TABBAR = [["", "#/", "Home", "house"], ["planner", "#/planner", "Planner", "planner"], ["courses", "#/courses", "Courses", "book"],
  ["messages", "#/messages", "Messages", "chat"], ["more", "#/more", "More", "more"]];
const MORE_KEYS = new Set(["more", "deadlines", "grades", "notifications", "settings"]);

function renderShell() {
  vp().innerHTML = `
  <div class="phone-top"><div class="brand" id="ptitle"><span class="brand-mark"></span>ACT Companion</div>
    <button class="btn btn-icon" type="button" aria-label="Search" data-action="palette">${ic("search")}</button>
    <a class="btn btn-icon" href="#/notifications" id="pbell" aria-label="Notifications">${ic("bell")}</a></div>
  <div class="app">
    <aside class="sidebar">${brand()}<nav class="side-nav" id="nav" aria-label="Main"></nav>
      <div class="sidebar-foot"><span>${esc((S.status.user || {}).fullname || "")}</span><span id="checked"></span></div></aside>
    <main class="main" id="view"></main>
  </div>
  <nav class="tabbar" id="tabbar" aria-label="Main"></nav>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <div class="palette-backdrop" id="palette" data-action="palette-bg" hidden>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search">
      <div class="palette-input">${ic("search")}<input type="text" id="pq" placeholder="Search courses, files, deadlines" aria-label="Search courses, files, deadlines" autocomplete="off" spellcheck="false" role="combobox" aria-controls="presults" aria-expanded="true"><span class="kbd">Esc</span></div>
      <div class="palette-results" id="presults" role="listbox"></div>
      <div class="palette-foot"><span><span class="kbd">&uarr;</span><span class="kbd">&darr;</span>Move</span><span><span class="kbd">Enter</span>Open</span><span><span class="kbd">Esc</span>Close</span><span style="margin-left:auto;">Ctrl K or /</span></div>
    </div>
  </div>`;
}

function renderNav(key) {
  $("#nav").innerHTML = NAV.map((n) => `<a class="nav-item" href="${n.href}" ${n.key === key ? 'aria-current="page"' : ""}>${ic(n.icon)}${n.label}${n.count ? `<span class="nav-count${n.count === "overdue" ? " is-danger" : ""}" data-count="${n.count}" hidden></span>` : ""}</a>`).join("");
  const tabKey = MORE_KEYS.has(key) ? "more" : key;
  $("#tabbar").innerHTML = TABBAR.map(([k, href, label, icon]) => `<a href="${href}" ${k === tabKey ? 'aria-current="page"' : ""}>${ic(icon)}${label}${k === "messages" ? '<span class="badge" data-count="messages" hidden></span>' : ""}</a>`).join("");
  renderCounts();
}

function overdueCount() {
  const n = nowS();
  return (S.deadlines || []).filter((e) => e.timesort < n && isOpenDeadline(e)).length;
}
function renderCounts() {
  const counts = {notifications: S.unread.notifications || 0, messages: S.unread.messages || 0, overdue: overdueCount()};
  for (const el of $$("[data-count]")) {
    const n = counts[el.dataset.count] || 0;
    el.hidden = !n;
    el.textContent = n > 99 ? "99+" : n;
  }
  const bell = $("#pbell");
  if (bell) bell.setAttribute("aria-label", `Notifications, ${counts.notifications} unread`);
  const ch = $("#checked");
  const w = S.status && S.status.watcher;
  if (ch && w) ch.textContent = w.last_error ? "Last check failed" : w.last_ok ? `Checked ${relTime(w.last_ok)}` : "Not checked yet";
}

// ---- boot, sign in, gate ---------------------------------------------------------------------

async function boot() {
  try {
    S.status = await api("/status");
  } catch (e) {
    return e.kind === "session" ? gatePage() : fatal(e);
  }
  if (!S.status.logged_in) return loginPage(S.status.expired);
  try {
    S.courses = await api("/courses");
  } catch (e) {
    return e.kind === "login" ? loginPage(true) : fatal(e);
  }
  S.moodleOrder = new Map(S.courses.map((c, i) => [c.id, i]));
  applyCourseOrder();
  renderShell();
  refreshUnread();
  getDeadlines().then(renderCounts).catch(() => {});
  route();
}

function fatal(e) {
  vp().innerHTML = `<div class="gate">${brand()}${errorBox(e)}</div>`;
}

function gatePage() {
  vp().innerHTML = `<div class="gate">${brand()}
    <h1 class="auth-title">Open ACT Companion from the app</h1>
    <p class="page-lede">This page only works when ACT Companion opens it for you. That keeps other websites and programs on this computer from reading your data.</p>
    <ol class="steps"><li>Start ACT Companion from your apps, or run <code>act-companion</code> in a terminal.</li><li>If it is already running, run it again. It reopens this page with the right key.</li></ol>
    <p class="spec">http://127.0.0.1:8765</p></div>`;
}

function stoppedPage() {
  vp().innerHTML = `<div class="gate">${brand()}<h1 class="auth-title">ACT Companion has stopped</h1>
    <p class="page-lede">Alerts are off until you open it again. You can close this tab.</p>
    <ol class="steps"><li>To start it again, open ACT Companion from your apps, or run <code>act-companion</code> in a terminal.</li></ol></div>`;
}

function loginPage(expired) {
  S.status = null;
  vp().innerHTML = `<div class="auth"><div class="auth-side">
    <div class="auth-mark">${brand()}</div>
    <div class="auth-points"><ul>
      <li>${ic("clock")}<span>Deadlines, grades, course files and messages from activity.act.edu in one place.</span></li>
      <li>${ic("bell")}<span>Desktop alerts before things are due and when grades are posted.</span></li>
      <li>${ic("house")}<span>Runs on your own computer. No servers, analytics or tracking.</span></li></ul></div>
    <p class="privacy" id="version">Open source, MIT license</p>
  </div><div class="auth-main"><form class="auth-form" id="login" novalidate>
    <header class="page-head"><h1 class="auth-title">Sign in</h1><p class="page-lede">Use your activity.act.edu username and password.</p></header>
    <div id="loginalert">${expired ? `<div class="alert" role="alert">${ic("warning")}<span>Your session expired. Sign in again.</span></div>` : ""}</div>
    <div class="field"><label for="u">Username</label><input class="input" id="u" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input class="input" id="p" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-primary btn-lg btn-block" type="submit" id="signin">Sign in</button>
    <p class="privacy">Your password goes only to activity.act.edu, once, to get an access token. It is never stored.</p>
    <div class="unofficial"><strong>Unofficial, not affiliated with the school.</strong> ACT Companion is a student project and is not endorsed or supported by the school.</div>
  </form></div></div><div class="toasts" id="toasts" aria-live="polite"></div>`;
  fetch("/api/ping").then((r) => r.json()).then((p) => { $("#version").textContent = `Version ${p.version} · Open source, MIT license`; }).catch(() => {});
  $("#u").focus();
  $("#login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const u = $("#u"), p = $("#p"), btn = $("#signin");
    if (!u.value.trim() || !p.value) { $("#loginalert").innerHTML = `<div class="alert" role="alert">${ic("warning")}<span>Enter your username and password.</span></div>`; return; }
    u.disabled = p.disabled = btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Signing in';
    try {
      await api("/login", {username: u.value, password: p.value});
      location.hash = "#/";
      boot();
    } catch (e) {
      u.disabled = p.disabled = btn.disabled = false;
      btn.textContent = "Sign in";
      const wrong = /invalid login/i.test(e.message);
      $("#loginalert").innerHTML = `<div class="alert" role="alert">${ic("warning")}<span>${wrong ? "Wrong username or password" : esc(e.message)}</span></div>`;
      p.setAttribute("aria-invalid", "true");
      p.focus();
    }
  });
}

// ---- router ------------------------------------------------------------------------------------

function parseHash() {
  const h = (location.hash || "#/").replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  return {parts: path.split("/").filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || ""))};
}

async function route() {
  if (!S.status || !$("#view")) return;
  const t = ++routeToken;
  painted = false;
  closePalette(false);
  const {parts, q} = parseHash();
  const [a = "", b, c, d, e, f] = parts;
  renderNav(a);
  vp().scrollTop = 0;
  const views = {
    "": () => homePage(t),
    planner: () => plannerPage(t, q),
    deadlines: () => deadlinesPage(t),
    courses: () => (!b ? coursesPage(t) : c === "forums" && e === "d" && f ? discussionPage(t, b, d, f) : coursePage(t, b, c || "content", d)),
    grades: () => gradesPage(t),
    messages: () => messagesPage(t, b),
    notifications: () => notificationsPage(t),
    settings: () => settingsPage(t, q),
    more: () => morePage(t),
  };
  try {
    await (views[a] || (() => notFound(t)))();
  } catch (err) {
    if (stale(t)) return;
    if (err.kind === "login") return loginPage(true);
    if (err.kind === "session") return gatePage();
    paint(t, `<header class="page-head"><h1 class="page-title">${esc(document.title.split(" · ")[0])}</h1></header>${errorBox(err)}`);
  } finally {
    if (!stale(t)) forceFresh = false;
  }
}

function notFound(t) {
  setMain("main");
  setTitle("Not found");
  paint(t, emptyState("That page does not exist", "", '<a class="btn btn-secondary" href="#/">Go home</a>', false));
}

// ---- shared rows ---------------------------------------------------------------------------------

function actionButton(e) {
  const day = dayDiff(e.timesort), over = e.timesort < nowS();
  const cls = over || day <= 0 ? "btn-primary" : day === 1 ? "btn-secondary" : "btn-ghost";
  return `<a class="btn ${cls}" href="${esc((e.action && e.action.url) || e.url || BASE)}" target="_blank" rel="noopener">${esc((e.action && e.action.name) || "View")}</a>`;
}

function deadlineRow(e, overdueWord = false) {
  const c = e.course || {}, over = e.timesort < nowS(), d = dt(e.timesort);
  const rel = over ? `<span class="is-danger">${overdueWord ? "Overdue" : esc(relTime(e.timesort))}</span>`
    : dayDiff(e.timesort) === 0 ? `<span class="is-now">${esc(relTime(e.timesort))}</span>` : `<span>${esc(relTime(e.timesort))}</span>`;
  return `<div class="row deadline-row ${cc(c.id)}${over ? " is-overdue" : ""}${isOpenDeadline(e) ? "" : " is-done"}" data-course="${c.id}">
    <div class="date"><span class="date-day">${d.getDate()}</span><span class="date-mon">${esc(d.toLocaleDateString([], {month: "short"}))}</span></div>
    <div><div class="row-title">${esc(e.activityname || e.name)}</div><div class="row-meta">${codeSpan(c)}<span>${esc(fmtDue(e.timesort))}</span>${rel}</div></div>
    ${actionButton(e)}</div>`;
}

function noteRow(n, timeText) {
  return `<a class="row note-row${n.read ? " is-read" : ""}" href="${esc(n.contexturl || BASE)}" target="_blank" rel="noopener" ${n.read ? "" : `data-note="${n.id}"`}>
    <span class="dot"></span><span>${esc(n.subject)}</span><time>${esc(timeText)}</time></a>`;
}

function courseRow(c) {
  return `<a class="row course-row ${cc(c.id)}" href="#/courses/${c.id}"><span class="course-bar"></span>
    <div><div class="row-title">${codeSpan(c)} ${esc(courseTitle(c))}</div><div class="row-meta"><span>${esc(courseTerm(c))}</span></div></div>
    ${gradeHtml(S.grades[c.id])}</a>`;
}

function recentBlock(r, title, withCourse) {
  if (!r || !r.recent || !r.recent.length) return "";
  return `<div class="block"><div class="block-head"><h2 class="block-title">${esc(title)}</h2><span class="block-link muted">checked ${esc(r.checked ? relTime(r.checked) : "not yet")}</span></div>
    ${r.recent.slice(0, 6).map((i) => `<a class="row note-row" href="${esc(i.fileurl || i.url)}" target="_blank" rel="noopener"><span class="dot"></span>
      <span>${withCourse ? `<span class="code ${cc(i.course)}">${esc(shortName(courseById(i.course)))}</span> ` : ""}${esc(i.title)}: ${esc(i.label)}</span><time>${esc(relTime(i.detected))}</time></a>`).join("")}</div>`;
}
const sigOf = (r) => ((r && r.recent) || []).map((i) => i.detected + i.label).join("|");

// ---- Home --------------------------------------------------------------------------------------

async function homePage(t) {
  setMain("main");
  setTitle("Home");
  loading(t, `${sk("480px", "36px", "border-radius:8px;")}<div class="page-head" style="gap:10px;">${sk("320px", "30px")}${sk("420px")}</div>
    <div class="grid-home"><div class="block"><div class="block-head"><span class="block-title">Up next</span></div>${skelRows(4)}</div>
    <div class="block"><div class="block-head"><span class="block-title">Your courses</span></div>${skelRows(5)}</div></div>`);
  const [events, notes, unread, recent] = await Promise.all([getDeadlines(forceFresh), api("/notifications"), refreshUnread(),
    contentAlertsOn() ? api("/recent") : null, getGrades(forceFresh)]);
  if (stale(t)) return;
  recentSig = recent ? sigOf(recent) : null;
  const n = nowS();
  const overdue = events.filter((e) => e.timesort < n && isOpenDeadline(e));
  const upcoming = events.filter((e) => e.timesort >= n);
  const week = upcoming.filter((e) => e.timesort - n < 7 * 86400);
  const h = new Date().getHours();
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = ((S.status.user && S.status.user.fullname) || "").split(" ")[0];
  const summary = (week.length ? `${week.length} due in the next 7 days` : "Nothing due in the next 7 days") + (overdue.length ? `, ${overdue.length} overdue.` : ".");
  const today = new Date().toLocaleDateString([], {weekday: "long", month: "long", day: "numeric"});
  const count = (num, label, href, cls) => `<a class="count${num && cls ? " " + cls : ""}" href="${href}"><span class="count-num">${num}</span><span class="count-label">${label}</span></a>`;
  paint(t, `
    <button class="search-trigger" type="button" data-action="palette">${ic("search", "icon-sm")}Search courses, files, deadlines<span class="kbd">Ctrl K</span></button>
    <header class="page-head"><h1 class="page-title">${hello}${first ? ", " + esc(first) : ""}</h1><p class="page-lede">${esc(today)}. ${esc(summary)}</p></header>
    <div class="counts">${count(week.length, "due this week", "#/deadlines")}${count(overdue.length, "overdue", "#/deadlines", "is-danger")}
      ${count(unread.notifications, "unread notifications", "#/notifications", "is-accent")}${count(unread.messages, "unread messages", "#/messages", "is-accent")}</div>
    <div class="grid-home">
      <div class="stack">
        <div class="block"><div class="block-head"><h2 class="block-title">Up next</h2><a class="block-link" href="#/deadlines">All deadlines</a></div>
          ${overdue.concat(upcoming).slice(0, 6).map((e) => deadlineRow(e, true)).join("") || emptyState("You're all caught up", "Nothing overdue and nothing due soon.")}</div>
        <div class="block"><div class="block-head"><h2 class="block-title">Latest notifications</h2><a class="block-link" href="#/notifications">View all</a></div>
          ${(notes.notifications || []).slice(0, 4).map((x) => noteRow(x, relTime(x.timecreated))).join("") || '<p class="muted">No notifications yet.</p>'}</div>
        ${recentBlock(recent, "New in your courses", true)}
      </div>
      <div class="block"><div class="block-head"><h2 class="block-title">Your courses</h2><a class="block-link" href="#/courses">View all</a></div>
        ${S.courses.map(courseRow).join("") || '<p class="muted">You are not enrolled in any courses.</p>'}</div>
    </div>`);
}

// ---- Planner -----------------------------------------------------------------------------------

function countdown(ts) {
  const left = ts - nowS();
  if (left < 0) {
    const late = -left;
    return late < 86400 ? `<span class="countdown is-danger">${Math.max(1, Math.round(late / 3600))}<small>h late</small></span>`
      : `<span class="countdown is-danger">${Math.round(late / 86400)}<small>d late</small></span>`;
  }
  return left < 86400 ? `<span class="countdown is-soon">${Math.max(1, Math.round(left / 3600))}<small>h</small></span>`
    : `<span class="countdown is-later">${Math.round(left / 86400)}<small>d</small></span>`;
}
function countdownRow(e) {
  const c = e.course || {};
  return `<div class="row countdown-row ${cc(c.id)}">${countdown(e.timesort)}
    <div><div class="row-title">${esc(e.activityname || e.name)}</div><div class="row-meta">${codeSpan(c)}<span>${esc(fmtDue(e.timesort))}</span></div></div>
    ${actionButton(e)}</div>`;
}
function dueCard(e, metaWhen, rel) {
  const c = e.course || {};
  return `<a class="due ${cc(c.id)}${isOpenDeadline(e) ? "" : " is-done"}" href="${esc((e.action && e.action.url) || e.url || BASE)}" target="_blank" rel="noopener">
    <span class="due-meta">${esc(shortName(c))} · ${esc(metaWhen)}</span><span class="due-title">${esc(e.activityname || e.name)}</span>${rel ? `<span class="due-rel">${esc(rel)}</span>` : ""}</a>`;
}

async function plannerPage(t, q) {
  setMain("main");
  setTitle("Planner");
  const off = parseInt(q.week || "0", 10) || 0;
  loading(t, `<header class="page-head"><h1 class="page-title">Planner</h1>${sk("280px")}</header><span class="skel" style="height:280px;border-radius:8px;"></span>`);
  const events = await getDeadlines(forceFresh);
  if (stale(t)) return;
  const n = nowS(), today = startOfDay(new Date()), start = addDays(today, off * 7), end = addDays(start, 7);
  const overdue = events.filter((e) => e.timesort < n && isOpenDeadline(e));
  const inRange = (e, a, b) => e.timesort * 1000 >= a.getTime() && e.timesort * 1000 < b.getTime();
  const lastDay = addDays(end, -1);
  const sameMonth = start.getMonth() === lastDay.getMonth();
  const wd = (d) => d.toLocaleDateString([], {weekday: "long"}), mon = (d) => d.toLocaleDateString([], {month: "long"});
  const fromLabel = `${wd(start)} ${start.getDate()}${sameMonth ? "" : " " + mon(start)}`;
  const toLabel = `${wd(lastDay)} ${lastDay.getDate()} ${mon(lastDay)}`;
  const days = Array.from({length: 7}, (_, i) => {
    const d0 = addDays(start, i), d1 = addDays(d0, 1);
    const items = events.filter((e) => inRange(e, d0, d1) && !(e.timesort < n && isOpenDeadline(e)));
    const isToday = d0.getTime() === today.getTime(), isPast = d0 < today;
    const head = `${esc(d0.toLocaleDateString([], {weekday: "short"}))}${isToday ? " · Today" : ""}`;
    return `<div class="day${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}"><div class="day-head"><span>${head}</span><span class="num">${d0.getDate()}</span></div>
      ${items.map((e) => dueCard(e, fmtHM(e.timesort), isToday ? relTime(e.timesort) : "")).join("") || '<span class="day-empty">Nothing due</span>'}</div>`;
  }).join("");
  const overdueCol = `<div class="day is-overdue"><div class="day-head"><span>Overdue</span><span class="num">${overdue.length}</span></div>
    ${overdue.map((e) => dueCard(e, off === 0 ? `${dt(e.timesort).toLocaleDateString([], {weekday: "short"})} ${fmtHM(e.timesort)}` : fmtShortDate(dt(e.timesort)),
      off === 0 ? `${plural(Math.max(1, Math.round((n - e.timesort) / 86400)), "day")} late` : "")).join("") || '<span class="day-empty">Nothing overdue</span>'}</div>`;
  const weekItems = events.filter((e) => inRange(e, start, end) && e.timesort >= n);
  const list = off === 0 ? overdue.concat(weekItems) : weekItems;
  paint(t, `
    <div class="head-row"><header class="page-head"><h1 class="page-title">Planner</h1><p class="page-lede">Week ${isoWeek(start)} · ${esc(fromLabel)} to ${esc(toLabel)}</p></header>
      <div class="week-nav" role="group" aria-label="Change week">
        <button class="btn btn-secondary" type="button" data-week="${off - 1}" title="Previous week (Alt+Left)">${ic("caret-left", "icon-sm")}Previous week</button>
        <button class="btn btn-secondary" type="button" data-week="0" ${off === 0 ? "disabled" : ""}>This week</button>
        <button class="btn btn-secondary" type="button" data-week="${off + 1}" title="Next week (Alt+Right)">Next week${ic("caret-right", "icon-sm")}</button>
      </div></div>
    <div class="week">${overdueCol}${days}</div>
    <div class="block"><div class="block-head"><h2 class="block-title">${off === 0 ? "Up next" : `Due in week ${isoWeek(start)}`}</h2><a class="block-link" href="#/deadlines">All deadlines</a></div>
      ${list.map(countdownRow).join("") || `<p class="muted">Nothing due ${off === 0 ? "this week" : "in this week"}.</p>`}</div>`);
}

// ---- Deadlines ---------------------------------------------------------------------------------

async function deadlinesPage(t) {
  setMain("main");
  setTitle("Deadlines");
  loading(t, skelPage("Deadlines"));
  const events = await getDeadlines(forceFresh);
  if (stale(t)) return;
  const n = nowS();
  const groups = [["Overdue", []], ["Today", []], ["Tomorrow", []], ["Next 7 days", []], ["Later", []]];
  for (const e of events) {
    if (e.timesort < n) { if (isOpenDeadline(e)) groups[0][1].push(e); continue; }
    const d = dayDiff(e.timesort);
    groups[d <= 0 ? 1 : d === 1 ? 2 : d < 7 ? 3 : 4][1].push(e);
  }
  const overdue = groups[0][1].length, week = events.filter((e) => e.timesort >= n && e.timesort - n < 7 * 86400).length;
  const lede = (week ? `${week} due in the next 7 days` : "Nothing due in the next 7 days") + (overdue ? `, ${overdue} overdue.` : ".");
  const soon = groups.slice(0, 4).some(([, l]) => l.length);
  const used = [...new Set(events.map((e) => (e.course || {}).id))];
  const groupHtml = ([name, list]) => list.length ? `<div class="group-label${name === "Overdue" ? " is-danger" : ""}" data-group><span>${name}</span><span class="num">${list.length}</span></div>
    ${list.map((e) => deadlineRow(e)).join("")}` : "";
  paint(t, `
    <div class="head-row"><header class="page-head"><h1 class="page-title">Deadlines</h1><p class="page-lede">${esc(lede)}</p></header>
      <div class="toolbar"><select class="select" style="width:180px;" aria-label="Course" id="dlcourse"><option value="">All courses</option>
        ${S.courses.filter((c) => used.includes(c.id)).map((c) => `<option value="${c.id}">${esc(shortName(c))}</option>`).join("")}</select></div></div>
    ${soon ? "" : emptyState("You're all caught up", "Nothing overdue and nothing due in the next 7 days.", groups[4][1].length ? '<button class="btn btn-secondary" type="button" data-action="later">See later deadlines</button>' : "")}
    <div class="block" id="dlist">${groups.map(groupHtml).join("")}</div>
    <p class="muted" style="font-size:13px;">Deadlines come from your Moodle calendar. Items you have submitted drop off automatically.</p>`);
}

function filterDeadlines(cid) {
  let label = null, shown = 0;
  const flush = () => { if (label) { label.hidden = shown === 0; $(".num", label).textContent = shown; } };
  for (const el of $("#dlist").children) {
    if (el.hasAttribute("data-group")) { flush(); label = el; shown = 0; continue; }
    const show = !cid || el.dataset.course === cid;
    el.hidden = !show;
    if (show) shown++;
  }
  flush();
}

// ---- Courses -----------------------------------------------------------------------------------

async function coursesPage(t) {
  setMain("main");
  setTitle("Courses");
  loading(t, skelPage("Courses"));
  await getGrades(forceFresh);
  if (stale(t)) return;
  const terms = [...new Set(S.courses.map(courseTerm).filter(Boolean))].join(", ");
  paint(t, `
    <div class="head-row"><header class="page-head"><h1 class="page-title">Courses</h1><p class="page-lede">${esc(terms)}${terms ? " · " : ""}${plural(S.courses.length, "course")}</p></header>
      <a class="btn btn-secondary" href="#/settings?focus=courses">${ic("sliders", "icon-sm")}Order and colors</a></div>
    <div class="course-list">${S.courses.map((c) => {
      const prog = typeof c.progress === "number" ? Math.round(c.progress) : null;
      const g = S.grades[c.id];
      return `<a class="course-card ${cc(c.id)}" href="#/courses/${c.id}">${codeSpan(c)}${hasGrade(g) ? `<span class="grade-big">${esc(g)}</span>` : '<span class="grade-none" style="grid-column:2;text-align:right;">Not graded yet</span>'}
        <span class="course-title">${esc(courseTitle(c))}</span><span class="course-term">${esc(courseTerm(c))}</span>
        ${prog !== null ? `<span class="progress"><span class="bar"><span style="width:${prog}%"></span></span><span class="num">${prog}% complete</span></span>` : ""}</a>`;
    }).join("")}</div>
    ${S.courses.length ? "" : emptyState("No courses", "You are not enrolled in any courses on activity.act.edu.", "", false)}`);
}

// ---- Course page -------------------------------------------------------------------------------

const TABS = [["content", "Content"], ["assignments", "Assignments"], ["forums", "Forums"], ["grades", "Grades"]];

function courseHeader(c) {
  const g = S.grades[c.id], prog = typeof c.progress === "number" ? Math.round(c.progress) : null;
  const meta = [hasGrade(g) ? `<span>Grade ${esc(g)}</span>` : "", prog !== null ? `<span>${prog}% complete</span>` : ""].join("");
  return `<div class="crumbs"><a href="#/courses">Courses</a><span>/</span><span>${esc(shortName(c))}</span></div>
    <div class="head-row ${cc(c.id)}"><header class="course-head"><span class="code">${esc(shortName(c))}${courseTerm(c) ? " · " + esc(courseTerm(c)) : ""}</span>
      <h1 class="page-title">${esc(courseTitle(c))}</h1>${meta ? `<div class="row-meta">${meta}</div>` : ""}</header>
      <a class="btn btn-secondary" href="${BASE}/course/view.php?id=${c.id}" target="_blank" rel="noopener">${ic("external", "icon-sm")}Open in Moodle</a></div>`;
}

async function coursePage(t, id, tab, sub) {
  const c = courseById(id) || {id: Number(id), fullname: "Course " + id};
  setMain("main");
  setTitle(shortName(c));
  if (!TABS.some(([k]) => k === tab)) tab = "content";
  const fresh = forceFresh;
  await getGrades().catch(() => {});
  if (stale(t)) return;
  paint(t, `${courseHeader(c)}
    <div class="course-wrap ${cc(c.id)}">
      <div class="tabs" role="tablist" aria-label="Course sections">${TABS.map(([k, label]) => `<button class="tab" role="tab" type="button" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" data-go="#/courses/${c.id}/${k}">${label}${k === "assignments" || k === "forums" ? `<span class="num" data-tabcount="${k}"></span>` : ""}</button>`).join("")}</div>
      <div id="tabbody">${skelRows(6, "list-row")}</div></div>`);
  // Fill the tab counts in the background (both responses are cached on the server).
  api("/assignments/" + c.id).then((r) => { const el = $('[data-tabcount="assignments"]'); if (el && !stale(t)) el.textContent = ((r.courses && r.courses[0] && r.courses[0].assignments) || []).length || ""; }).catch(() => {});
  api("/forums/" + c.id).then((r) => { const el = $('[data-tabcount="forums"]'); if (el && !stale(t)) el.textContent = r.length || ""; }).catch(() => {});
  const body = () => (stale(t) ? null : $("#tabbody"));
  if (tab === "content") return courseContent(t, c, fresh, body);
  if (tab === "assignments") return courseAssignments(t, c, body);
  if (tab === "forums") return courseForums(t, c, sub, body);
  return courseGrades(t, c, body);
}

const EXT_LABEL = (name) => (name && name.includes(".") ? name.split(".").pop() : "file").toUpperCase().slice(0, 4);
const KIND_ICON = {forum: "forum", url: "link", folder: "folder", assign: "assignment", quiz: "quiz"};
const MOD_LABEL = {assign: "Assignment", quiz: "Quiz", forum: "Forum", page: "Page", folder: "Folder", url: "Link", resource: "File", book: "Book",
  lti: "External tool", h5pactivity: "Interactive content", choice: "Choice", feedback: "Feedback", glossary: "Glossary", lesson: "Lesson",
  scorm: "SCORM package", wiki: "Wiki", workshop: "Workshop", data: "Database", bigbluebuttonbn: "Online meeting"};
const fmtSize = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";

function modInfo(m) {
  const files = (m.contents || []).filter((f) => f.type === "file");
  const single = m.modname !== "folder" && files[0] ? files[0] : null;
  let meta;
  if (m.modname === "folder") meta = `Folder · ${plural(files.length, "file")}`;
  else if (single) meta = `${EXT_LABEL(single.filename)} · ${fmtSize(single.filesize)}${files.length > 1 ? ` · ${files.length} files` : ""}`;
  else if (m.modname === "url") {
    const u = ((m.contents || [])[0] || {}).fileurl;
    let host = "";
    try { host = u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch (e) { /* not a URL */ }
    meta = "Link" + (host ? " · " + host : "");
  } else {
    const label = MOD_LABEL[m.modname] || m.modplural || m.modname;
    const d = (m.dates || []).find((x) => x.timestamp);
    meta = d ? `${label} · ${String(d.label || "").replace(/:\s*$/, "")} ${fmtDue(d.timestamp, true)}` : label;
  }
  return {files, single, meta, desc: strip(m.description).toLowerCase()};
}

function highlight(text, q) {
  if (!q) return esc(text);
  const lower = text.toLowerCase(), out = [];
  let i = 0, j;
  while ((j = lower.indexOf(q, i)) !== -1) { out.push(esc(text.slice(i, j)), "<mark>", esc(text.slice(j, j + q.length)), "</mark>"); i = j + q.length; }
  out.push(esc(text.slice(i)));
  return out.join("");
}

function fileRow(m, info) {
  const type = info.single ? `<span class="file-type">${esc(EXT_LABEL(info.single.filename))}</span>`
    : `<span class="file-type is-kind">${ic(KIND_ICON[m.modname] || "file")}</span>`;
  const name = esc(m.name);
  return `<div class="file-row" data-name="${esc(m.name.toLowerCase())}" data-label="${name}" data-desc="${esc(info.desc)}">${type}
    <div><div class="file-name">${name}</div><div class="file-meta">${esc(info.meta)}</div></div>
    <span class="file-actions">${info.single ? `<a class="btn btn-icon" href="${esc(info.single.fileurl)}" download data-download="${esc(info.single.filename)}" aria-label="Download ${name}">${ic("download", "icon-sm")}</a>` : ""}
      ${m.url ? `<a class="btn btn-icon" href="${esc(m.url)}" target="_blank" rel="noopener" aria-label="Open ${name} in Moodle">${ic("external", "icon-sm")}</a>` : ""}</span></div>`;
}

const collapseKey = (cid) => "collapse:" + cid;
const getCollapsed = (cid) => { try { return new Set(JSON.parse(store.get(collapseKey(cid)) || "[]")); } catch (e) { return new Set(); } };

async function courseContent(t, c, fresh, body) {
  const [sections, recent] = await Promise.all([api("/course/" + c.id + (fresh ? "?fresh=1" : "")),
    contentAlertsOn() ? api("/recent?course=" + c.id).catch(() => null) : null]);
  const el = body();
  if (!el) return;
  recentSig = recent ? sigOf(recent) : null;
  const secs = sections.map((s) => ({...s, modules: (s.modules || []).filter((m) => m.modname !== "label" && m.modname !== "subsection" && m.uservisible !== false)}))
    .filter((s) => s.modules.length);
  const total = secs.reduce((n, s) => n + s.modules.length, 0);
  if (!secs.length) { el.innerHTML = emptyState("Nothing here yet", "This course has no visible content.", "", false); return; }
  const collapsed = getCollapsed(c.id);
  el.innerHTML = `${recentBlock(recent, "New in this course", false)}
    <div class="toolbar"><div class="filter">${ic("search")}<input class="input" type="search" id="filter" placeholder="Filter ${total} items" aria-label="Filter items"></div>
      <button class="btn btn-ghost" type="button" data-action="toggle-all" id="toggleall"></button><span class="filter-count" id="fcount" hidden></span></div>
    <div id="secs" data-course="${c.id}">${secs.map((s) => {
      const infos = s.modules.map(modInfo);
      const files = infos.filter((i) => i.single).length, n = s.modules.length;
      const count = files === n ? plural(n, "file") : files >= 2 ? `${plural(n, "item")} · ${files} files` : plural(n, "item");
      const open = !collapsed.has(String(s.id));
      return `<div class="section" data-sec="${s.id}"><button class="section-toggle" type="button" aria-expanded="${open}">${ic("caret")}<span class="section-title">${esc(s.name)}</span>
        <span class="section-count" data-count-text="${esc(count)}">${esc(count)}</span></button>
        <div class="section-body"${open ? "" : " hidden"}>${s.modules.map((m, i) => fileRow(m, infos[i])).join("")}</div></div>`;
    }).join("")}</div>
    <div id="nomatch" hidden>${emptyState("No matches", "Try a different word, or clear the filter.", "", false)}</div>`;
  syncToggleAll();
}

function syncToggleAll() {
  const b = $("#toggleall");
  if (!b) return;
  const all = $$("#secs .section-toggle");
  b.textContent = all.length && all.every((x) => x.getAttribute("aria-expanded") === "false") ? "Expand all" : "Collapse all";
}
function setSection(sec, open, remember = true) {
  $(".section-toggle", sec).setAttribute("aria-expanded", String(open));
  $(".section-body", sec).hidden = !open;
  if (!remember) return;
  const cid = $("#secs").dataset.course, set = getCollapsed(cid);
  open ? set.delete(sec.dataset.sec) : set.add(sec.dataset.sec);
  store.set(collapseKey(cid), JSON.stringify([...set]));
}

let filterTimer = null;
function filterContent(raw) {
  const q = raw.trim().toLowerCase();
  let matches = 0, secHits = 0;
  for (const sec of $$("#secs .section")) {
    const rows = $$(".file-row", sec);
    let n = 0;
    for (const r of rows) {
      const inName = q && r.dataset.name.includes(q), inDesc = q && !inName && r.dataset.desc.includes(q);
      const show = !q || inName || inDesc;
      r.hidden = !show;
      // dataset values are raw text, so they are always escaped (highlight() escapes too) before going back into the page.
      $(".file-name", r).innerHTML = inName ? highlight(r.dataset.label, q)
        : inDesc ? `${esc(r.dataset.label)} <span class="match-note">(matched in description: ${esc(q)})</span>` : esc(r.dataset.label);
      if (show) n++;
    }
    const cnt = $(".section-count", sec);
    cnt.textContent = q ? `${n} of ${rows.length}` : cnt.dataset.countText;
    sec.hidden = q && n === 0;
    if (q && n) { $(".section-toggle", sec).setAttribute("aria-expanded", "true"); $(".section-body", sec).hidden = false; }
    matches += n;
    if (q && n) secHits++;
  }
  if (!q) { // clearing the filter restores the remembered collapse state
    const set = getCollapsed($("#secs").dataset.course);
    for (const sec of $$("#secs .section")) setSection(sec, !set.has(sec.dataset.sec), false);
  }
  $("#toggleall").hidden = !!q;
  const fc = $("#fcount");
  fc.hidden = !q;
  fc.textContent = q ? `${plural(matches, "match", "matches")} in ${plural(secHits, "section")}` : "";
  $("#nomatch").hidden = !q || matches > 0;
  syncToggleAll();
}

function assignmentStatus(a) {
  const n = nowS(), st = a.status;
  if (a.allowsubmissionsfromdate && a.allowsubmissionsfromdate > n) return ["is-todo", `Opens ${fmtShortDate(dt(a.allowsubmissionsfromdate))}`];
  if (!st) return ["", "Open in Moodle for status"];
  if (st.grading === "graded") return ["is-ok", "Graded" + (st.grade ? " " + strip(st.grade) : "")];
  if (st.submission === "submitted") return ["is-ok", "Submitted, not graded"];
  if (st.submission === "draft") return ["is-todo", "Draft saved"];
  return [a.duedate && a.duedate < n ? "is-danger" : "is-todo", "Not submitted"];
}

async function courseAssignments(t, c, body) {
  const r = await api("/assignments/" + c.id);
  const el = body();
  if (!el) return;
  const n = nowS();
  const list = ((r.courses && r.courses[0] && r.courses[0].assignments) || []).slice();
  const notOpen = (a) => a.allowsubmissionsfromdate && a.allowsubmissionsfromdate > n;
  list.sort((a, b) => (notOpen(a) - notOpen(b)) || ((b.duedate || 0) - (a.duedate || 0)));
  if (!list.length) { el.innerHTML = emptyState("No assignments", "This course has no assignments yet.", "", false); return; }
  el.innerHTML = `<table class="table"><thead><tr><th>Assignment</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((a) => { const [cls, text] = assignmentStatus(a); return `<tr><td>${esc(a.name)}</td>
      <td class="num due-cell">${a.duedate ? esc(fmtDue(a.duedate)) : "No due date"}</td><td><span class="status ${cls}">${esc(text)}</span></td>
      <td class="r"><a class="btn btn-icon" href="${BASE}/mod/assign/view.php?id=${a.cmid}" target="_blank" rel="noopener" aria-label="Open ${esc(a.name)} in Moodle">${ic("external", "icon-sm")}</a></td></tr>`; }).join("")}
    </tbody></table>`;
}

async function courseForums(t, c, fid, body) {
  const forums = await api("/forums/" + c.id);
  const el = body();
  if (!el) return;
  if (!forums.length) { el.innerHTML = emptyState("No forums", "This course has no forums.", "", false); return; }
  const discs = await Promise.all(forums.map((f) => api("/discussions/" + f.id).then((r) => r.discussions || []).catch(() => [])));
  if (!body()) return;
  const sel = forums.find((f) => String(f.id) === String(fid)) || forums[0];
  const selDiscs = discs[forums.indexOf(sel)];
  el.innerHTML = `<div class="block">${forums.map((f, i) => {
      const unread = discs[i].reduce((s, d) => s + (d.numunread || 0), 0);
      const intro = f.type === "news" ? "Instructor posts" : strip(f.intro).slice(0, 80);
      return `<a class="row forum-row${f === sel ? " is-selected" : ""}" href="#/courses/${c.id}/forums/${f.id}">${ic("forum")}
        <div><div class="row-title">${esc(f.name)}</div><div class="row-meta">${intro ? `<span>${esc(intro)}</span>` : ""}<span>${plural(f.numdiscussions || discs[i].length, "discussion")}</span></div></div>
        <span class="replies${unread ? " is-new" : ""}">${unread} new</span></a>`;
    }).join("")}</div>
    <div class="block"><div class="block-head"><h2 class="block-title">${esc(sel.name)}</h2><a class="block-link" href="${BASE}/mod/forum/view.php?f=${sel.id}" target="_blank" rel="noopener">Open in Moodle</a></div>
      ${selDiscs.map((d) => `<a class="row discussion-row" href="#/courses/${c.id}/forums/${sel.id}/d/${d.discussion}">
        <div><div class="row-title">${esc(d.name)}</div><div class="row-meta"><span>${esc(d.userfullname)}</span><span>${esc(relTime(d.timemodified || d.created))}</span></div></div>
        <span class="replies${d.numunread ? " is-new" : ""}">${plural(d.numreplies || 0, "reply", "replies")}</span></a>`).join("") || '<p class="muted">No discussions yet.</p>'}</div>`;
}

async function discussionPage(t, cid, fid, did) {
  const c = courseById(cid) || {id: Number(cid)};
  setMain("main");
  setTitle("Discussion");
  loading(t, skelPage("Discussion"));
  const [forums, discs, r] = await Promise.all([api("/forums/" + cid), api("/discussions/" + fid).then((x) => x.discussions || []), api("/posts/" + did)]);
  if (stale(t)) return;
  const forum = forums.find((f) => String(f.id) === String(fid)) || {name: "Forum"};
  const disc = discs.find((d) => String(d.discussion) === String(did)) || {};
  const posts = (r.posts || []).slice().sort((a, b) => a.timecreated - b.timecreated);
  const firstPost = posts.find((p) => !p.parentid) || posts[0] || {};
  const title = disc.name || firstPost.subject || "Discussion";
  setTitle(title);
  paint(t, `<div class="course-wrap ${cc(c.id)}">
    <div class="crumbs"><a href="#/courses/${c.id}">${esc(shortName(c))}</a><span>/</span><a href="#/courses/${c.id}/forums/${fid}">Forums</a><span>/</span><span>${esc(forum.name)}</span></div>
    <header class="page-head"><h1 class="page-title discussion-title">${esc(title)}</h1><div class="row-meta">
      <span>Started by ${esc((firstPost.author && firstPost.author.fullname) || disc.userfullname || "")}</span><span>${plural(Math.max(0, posts.length - 1), "reply", "replies")}</span>
      <a href="${BASE}/mod/forum/discuss.php?d=${did}" target="_blank" rel="noopener">Reply in Moodle</a></div></header>
    <div id="posts"></div></div>`);
  const box = $("#posts");
  box.replaceChildren(...posts.map((p) => {
    const a = document.createElement("article");
    a.className = "post" + (p.parentid ? " is-reply" : "");
    a.innerHTML = `<div class="post-head"><span class="post-author">${esc(p.author && p.author.fullname)}</span><span class="muted" style="font-size:13px;">${esc(fmtDue(p.timecreated))}</span></div>`;
    a.append(postFrame(p.message));
    if ((p.attachments || []).length) {
      const att = document.createElement("div");
      att.className = "attachments";
      att.innerHTML = p.attachments.map((x) => `<a class="attachment" href="${esc(x.fileurl)}" target="_blank" rel="noopener">${ic("file", "icon-sm")}${esc(x.filename)}${x.filesize ? `<span class="muted">${fmtSize(x.filesize)}</span>` : ""}</a>`).join("");
      a.append(att);
    }
    return a;
  }));
}

async function courseGrades(t, c, body) {
  const r = await api("/grades/" + c.id);
  const el = body();
  if (!el) return;
  const items = (r.usergrades && r.usergrades[0] && r.usergrades[0].gradeitems) || [];
  if (!items.length) { el.innerHTML = emptyState("No grades yet", "Grades appear here once your teacher posts them.", "", false); return; }
  const range = (s) => String(s || "").replace(/\s*[–-]\s*/, " to ");
  el.innerHTML = `<table class="table"><thead><tr><th>Grade item</th><th class="r">Grade</th><th class="r hide-sm">Range</th><th class="r">Percentage</th><th class="hide-sm">Feedback</th></tr></thead><tbody>
    ${items.map((i) => {
      const total = i.itemtype === "course";
      const pct = (i.percentageformatted || "").trim();
      return `<tr class="${total ? "total" : ""}"><td>${esc(i.itemname || (total ? "Course total" : "Category total"))}</td>
        <td class="r">${hasGrade(i.gradeformatted) ? esc(i.gradeformatted) : '<span class="grade-none">Not graded yet</span>'}</td>
        <td class="r muted hide-sm">${esc(range(i.rangeformatted))}</td><td class="r">${hasGrade(pct) ? esc(pct) : '<span class="muted">None</span>'}</td>
        <td class="feedback hide-sm">${esc(strip(i.feedback))}</td></tr>`;
    }).join("")}</tbody></table>`;
}

// ---- Grades overview ---------------------------------------------------------------------------

async function gradesPage(t) {
  setMain("main");
  setTitle("Grades");
  loading(t, skelPage("Grades"));
  await getGrades(forceFresh);
  const details = await Promise.all(S.courses.map((c) => api("/grades/" + c.id).catch(() => null)));
  if (stale(t)) return;
  paint(t, `<header class="page-head"><h1 class="page-title">Grades</h1><p class="page-lede">Course totals as shown in Moodle. Open a course for item-by-item grades and feedback.</p></header>
    <table class="table"><thead><tr><th>Course</th><th class="r">Total</th><th class="hide-sm">Progress</th><th class="r hide-sm">Updated</th></tr></thead><tbody>
    ${S.courses.map((c, i) => {
      const items = (details[i] && details[i].usergrades && details[i].usergrades[0] && details[i].usergrades[0].gradeitems) || [];
      const totalItem = items.find((x) => x.itemtype === "course");
      const pct = totalItem ? parseFloat(totalItem.percentageformatted) : NaN;
      const updated = Math.max(0, ...items.map((x) => x.gradedategraded || 0));
      const g = S.grades[c.id];
      return `<tr class="${cc(c.id)}"><td><a class="course-cell" href="#/courses/${c.id}/grades" style="color:inherit;"><span class="code">${esc(shortName(c))}</span><span>${esc(courseTitle(c))}</span></a></td>
        <td class="r">${gradeHtml(g)}</td><td class="bar-cell hide-sm">${hasGrade(g) && !isNaN(pct) ? `<span class="bar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>` : ""}</td>
        <td class="r hide-sm muted" style="font-size:13px;">${updated ? esc(relTime(updated)) : ""}</td></tr>`;
    }).join("")}</tbody></table>`);
}

// ---- Messages ----------------------------------------------------------------------------------

async function messagesPage(t, convId) {
  setMain("main");
  setTitle("Messages");
  loading(t, skelPage("Messages"));
  const r = await api("/conversations");
  if (stale(t)) return;
  const me = S.status.user.userid;
  const convs = (r.conversations || []).filter((c) => c.type !== 3 || (c.messages || []).length);
  const nameOf = (c) => c.name || (c.members || []).filter((m) => m.id !== me).map((m) => m.fullname).join(", ") || (c.type === 3 ? "Personal notes" : "Conversation");
  const unread = convs.filter((c) => c.unreadcount).length;
  if (!convs.length) {
    paint(t, `<header class="page-head"><h1 class="page-title">Messages</h1></header>
      ${emptyState("No messages yet", "When someone messages you on activity.act.edu, the conversation shows up here.",
        `<a class="btn btn-secondary" href="${BASE}/message/index.php" target="_blank" rel="noopener">${ic("external", "icon-sm")}Open messages in Moodle</a>`, false)}`);
    return;
  }
  // On wide screens open the first conversation; on phones show the list until one is picked.
  if (!convId && vp().clientWidth > 760) convId = String(convs[0].id);
  paint(t, `<header class="page-head"><h1 class="page-title">Messages</h1><p class="page-lede">${unread ? `${unread} unread. ` : ""}Replies open in Moodle.</p></header>
    <div class="two-pane${convId ? " has-thread" : ""}"><div class="convo-list">${convs.map((c) => {
      const last = (c.messages || [])[0];
      return `<a class="convo${c.unreadcount ? " is-unread" : ""}" href="#/messages/${c.id}" ${String(c.id) === convId ? 'aria-current="true"' : ""}>
        <span class="convo-name">${esc(nameOf(c))}</span><span class="convo-time">${last ? esc(shortWhen(last.timecreated)) : ""}</span>
        <span class="convo-preview">${esc(strip(last && last.text))}</span></a>`;
    }).join("")}</div><div class="thread" id="thread">${convId ? `<div class="thread-body">${skelRows(3)}</div>` : ""}</div></div>`);
  if (!convId) return;
  const conv = convs.find((c) => String(c.id) === convId);
  const th = await api("/conversation/" + convId);
  if (stale(t)) return;
  const other = conv && (conv.members || []).find((m) => m.id !== me);
  let lastDay = "";
  const msgs = (th.messages || []).slice().sort((a, b) => a.timecreated - b.timecreated).map((m) => {
    const day = startOfDay(dt(m.timecreated)).getTime();
    const sep = day !== lastDay ? `<div class="day-sep">${esc(dayDiff(m.timecreated) === 0 ? "Today" : dayDiff(m.timecreated) === -1 ? "Yesterday" : fmtLongDate(dt(m.timecreated)))}</div>` : "";
    lastDay = day;
    const mine = m.useridfrom === me;
    const who = mine ? "You" : ((th.members || []).find((x) => x.id === m.useridfrom) || {}).fullname || (conv ? nameOf(conv) : "");
    return `${sep}<div class="msg${mine ? " is-mine" : ""}"><span class="msg-meta">${esc(who)} · ${esc(fmtHM(m.timecreated))}</span><div class="msg-text">${esc(strip(m.text))}</div></div>`;
  }).join("");
  $("#thread").innerHTML = `<div class="thread-head"><div style="display:flex;gap:8px;align-items:center;">
      <a class="btn btn-icon back-link" href="#/messages" aria-label="Back to conversations">${ic("caret-left")}</a>
      <div><div class="convo-name">${esc(conv ? nameOf(conv) : "Conversation")}</div><div class="thread-sub">Read only here</div></div></div>
    <a class="btn btn-secondary" href="${BASE}/message/index.php${other ? "?id=" + other.id : ""}" target="_blank" rel="noopener">${ic("external", "icon-sm")}Reply in Moodle</a></div>
    <div class="thread-body">${msgs || '<p class="muted">No messages in this conversation.</p>'}</div>`;
}

// ---- Notifications -----------------------------------------------------------------------------

async function notificationsPage(t) {
  setMain("main");
  setTitle("Notifications");
  loading(t, skelPage("Notifications"));
  const r = await api("/notifications");
  if (stale(t)) return;
  const list = r.notifications || [];
  const unread = list.filter((n) => !n.read).length;
  const groups = new Map();
  for (const n of list) {
    const d = dayDiff(n.timecreated);
    const label = d === 0 ? "Today" : d === -1 ? "Yesterday" : fmtLongDate(dt(n.timecreated));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(n);
  }
  paint(t, `<div class="head-row"><header class="page-head"><h1 class="page-title">Notifications</h1><p class="page-lede">${list.length ? `${unread} unread of ${list.length}` : ""}</p></header>
      ${unread ? `<button class="btn btn-secondary" type="button" data-action="markread">${ic("check", "icon-sm")}Mark all as read</button>` : ""}</div>
    ${list.length ? `<div class="block">${[...groups].map(([label, l]) => `<div class="group-label"><span>${esc(label)}</span><span class="num">${l.length}</span></div>
      ${l.map((n) => noteRow(n, fmtHM(n.timecreated))).join("")}`).join("")}</div>` : emptyState("No notifications", "Moodle notifications for your account show up here.", "", false)}`);
}

// ---- More (phone) ------------------------------------------------------------------------------

function morePage(t) {
  setMain("main");
  setTitle("More");
  const row = (href, icon, label, count) => `<a class="row list-row" href="${href}"><span class="row-title" style="display:flex;gap:10px;align-items:center;">${ic(icon)}${label}</span>${count ? `<span class="badge">${count}</span>` : ""}</a>`;
  paint(t, `<header class="page-head"><h1 class="page-title">More</h1></header><div class="block">
    ${row("#/deadlines", "clock", "Deadlines", overdueCount())}${row("#/grades", "chart", "Grades")}
    ${row("#/notifications", "bell", "Notifications", S.unread.notifications)}${row("#/settings", "sliders", "Settings")}</div>`);
}

// ---- Settings ----------------------------------------------------------------------------------

const toggle = (attrs, checked, label, disabled = false) => `<label class="toggle"><input type="checkbox" role="switch" ${attrs} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} aria-label="${esc(label)}"><span class="track"></span></label>`;
const currentTheme = () => store.get("theme") || "system";

function coRow(c, i, n) {
  const code = esc(shortName(c));
  return `<li class="co-row ${cc(c.id)}" data-id="${c.id}"><span class="co-handle" data-handle aria-hidden="true">${ic("grip")}</span>
    <button class="co-color" type="button" data-action="co-color" aria-label="Color for ${code}: ${COLOR_NAMES[(S.color[c.id] || 1) - 1]}" aria-expanded="false"></button>
    <span class="co-name">${codeSpan(c)} ${esc(courseTitle(c))}</span>
    <span class="co-move"><button class="btn btn-icon" type="button" data-action="co-up" aria-label="Move ${code} up" ${i === 0 ? "disabled" : ""}>${ic("arrow-up", "icon-sm")}</button>
      <button class="btn btn-icon" type="button" data-action="co-down" aria-label="Move ${code} down" ${i === n - 1 ? "disabled" : ""}>${ic("arrow-down", "icon-sm")}</button></span></li>`;
}

function statusLine(w) {
  const ok = !w.last_error;
  const parts = [w.last_run ? `Last check ${relTime(w.last_run)}` : "Not checked yet", w.next_run ? `next ${relTime(w.next_run)}` : ""].filter(Boolean);
  return `<div class="setting-title"><span class="status ${ok ? "is-ok" : "is-danger"}">${ok ? "Background checks working" : "Last check failed"}</span></div>
    <div class="setting-desc">${ok ? "" : esc(w.last_error) + ". "}${esc(parts.join(", "))}.</div>`;
}

async function settingsPage(t, q) {
  setMain("main main-narrow");
  setTitle("Settings");
  loading(t, skelPage("Settings"));
  S.status = await api("/status");
  if (stale(t)) return;
  const s = S.status.settings, u = S.status.user || {};
  const theme = currentTheme();
  const watchAll = s.watch_courses === null;
  const watched = new Set(s.watch_courses || []);
  const opt = (vals, cur, unit) => vals.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${v === 60 ? "1 hour" : plural(v, unit)}</option>`).join("");
  const preview = (th) => th === "system"
    ? `<span class="theme-preview is-split"><span data-theme="nocturne"><span class="tp-side"><i></i><i></i><i></i></span><span class="tp-main"><b></b><i></i></span></span><span data-theme="daylight"><span class="tp-side"><i></i><i></i><i></i></span><span class="tp-main"><b></b><i></i></span></span></span>`
    : `<span class="theme-preview" data-theme="${th}"><span class="tp-side"><i></i><i></i><i></i><i></i></span><span class="tp-main"><b></b><i></i><i></i><span class="tp-swatches"><span></span><span></span><span></span><span></span><span></span><span></span></span></span></span>`;
  paint(t, `<header class="page-head"><h1 class="page-title">Settings</h1><p class="page-lede">Changes save as you make them.</p></header>

  <div class="block"><div class="block-head"><h2 class="block-title">Account</h2></div>
    <div class="setting"><div><div class="setting-title">${esc(u.fullname || "")}</div><div class="setting-desc">Signed in${u.username ? " as " + esc(u.username) : ""} on activity.act.edu</div></div>
      <button class="btn btn-secondary" type="button" data-action="signout">${ic("sign-out", "icon-sm")}Sign out</button></div>
    <div class="setting"><div id="statusline">${statusLine(S.status.watcher)}</div>
      <button class="btn btn-secondary" type="button" data-action="check" id="checkbtn">${ic("retry", "icon-sm")}Check now</button></div></div>

  <div class="block"><div class="block-head"><h2 class="block-title">Appearance</h2></div>
    <div class="setting is-full"><div><div class="setting-title">Theme</div><div class="setting-desc">System follows your computer: Nocturne when it is in dark mode, Daylight when it is light.</div></div>
      <div class="themes" role="radiogroup" aria-label="Theme">${THEMES.map(([v, label]) => `<label class="theme-opt"><input type="radio" name="theme" value="${v}" ${v === theme ? "checked" : ""}>${preview(v)}<span class="theme-name">${label}</span></label>`).join("")}</div></div></div>

  <div class="block" id="courses-block"><div class="block-head"><h2 class="block-title">Courses</h2><button class="btn btn-ghost" type="button" data-action="co-reset">Reset</button></div>
    <p class="setting-desc settings-note">Drag to reorder, or use the arrows. Click a color to change it. Order and colors apply everywhere: Home, Planner, Courses, Grades and search.</p>
    <ol class="course-order" id="colist" aria-label="Course order">${S.courses.map((c, i) => coRow(c, i, S.courses.length)).join("")}</ol></div>

  <div class="block"><div class="block-head"><h2 class="block-title">Alerts</h2><button class="btn btn-ghost" type="button" data-action="test">${ic("send", "icon-sm")}Send a test alert</button></div>
    <div class="setting"><div><div class="setting-title">Deadlines and reminders</div><div class="setting-desc">New deadlines, and a reminder before each one is due.</div></div>${toggle('data-set="alerts.deadlines"', s.alerts.deadlines, "Deadlines and reminders")}</div>
    <div class="setting is-sub${s.alerts.deadlines ? "" : " is-off"}" data-parent="deadlines"><div><div class="setting-title">Remind me this many hours before</div><div class="setting-desc">Separate with commas.</div></div>
      <input class="input num reminder-input" id="reminders" value="${esc(s.reminder_hours.join(", "))}" aria-label="Reminder hours" inputmode="decimal" ${s.alerts.deadlines ? "" : "disabled"}></div>
    <div class="setting"><div><div class="setting-title">New grades</div><div class="setting-desc">When a grade is posted in a watched course.</div></div>${toggle('data-set="alerts.grades"', s.alerts.grades, "New grades")}</div>
    <div class="setting is-sub${s.alerts.grades && s.grades_show_value ? "" : " is-off"}" data-parent="grades"><div><div class="setting-title">Show the grade in the alert</div><div class="setting-desc">Off: the alert only says a grade was posted.</div></div>
      ${toggle('data-set="grades_show_value"', s.grades_show_value, "Show the grade in the alert", !s.alerts.grades)}</div>
    <div class="setting${s.alerts.content ? "" : " is-off"}"><div><div class="setting-title">Course changes</div><div class="setting-desc">New or newly visible files, resources and forum posts. Off by default because it adds requests to the school's server.</div></div>${toggle('data-set="alerts.content"', s.alerts.content, "Course changes")}</div></div>

  <div class="block"><div class="block-head"><h2 class="block-title">Checking</h2></div>
    <div class="setting"><div><div class="setting-title">Courses to watch</div></div><div class="seg" role="radiogroup" aria-label="Courses to watch">
      <label class="seg-opt"><input type="radio" name="watch" value="all" ${watchAll ? "checked" : ""}>All courses</label><label class="seg-opt"><input type="radio" name="watch" value="selected" ${watchAll ? "" : "checked"}>Selected</label></div></div>
    <div class="course-checks" id="watchlist" ${watchAll ? "hidden" : ""}>${S.courses.map((c) => `<div class="setting ${cc(c.id)}"><div class="setting-title">${codeSpan(c)} ${esc(courseTitle(c))}</div>
      ${toggle(`data-watch="${c.id}"`, watchAll || watched.has(c.id), "Watch " + shortName(c))}</div>`).join("")}</div>
    <div class="setting"><div><div class="setting-title">Check deadlines${s.alerts.content ? " and course changes" : ""} every</div></div><select class="select freq-select" data-set="interval_minutes" aria-label="Deadline check frequency">${opt([1, 2, 5, 10, 15, 30], s.interval_minutes, "minute")}</select></div>
    <div class="setting"><div><div class="setting-title">Check grades every</div><div class="setting-desc">Shorter intervals add load to the school's server.</div></div><select class="select freq-select" data-set="grades_interval_minutes" aria-label="Grade check frequency">${opt([5, 15, 30, 60], s.grades_interval_minutes, "minute")}</select></div></div>

  <div class="block"><div class="block-head"><h2 class="block-title">This computer</h2></div>
    ${S.status.autostart.supported ? `<div class="setting"><div><div class="setting-title">Start when I log in to this computer</div><div class="setting-desc">Alerts only arrive while ACT Companion is running.</div></div>${toggle("data-autostart", S.status.autostart.enabled, "Start at login")}</div>` : ""}
    <div class="setting"><div><div class="setting-title">Quit ACT Companion</div><div class="setting-desc">Closing the tab keeps it running. Quitting stops alerts until you open it again. Version ${esc(S.status.version)}.</div></div>
      <button class="btn btn-danger" type="button" data-action="quit">${ic("power", "icon-sm")}Quit</button></div></div>`);
  if (q.focus === "courses") $("#courses-block").scrollIntoView({block: "start"});
}

async function saveSettings(patch, msg = "Saved") {
  try {
    S.status.settings = await api("/settings", patch);
    applyCourseOrder();
    if (msg) toast(msg);
    return true;
  } catch (e) {
    toast("Couldn't save. " + e.message, {error: true, retry: () => saveSettings(patch, msg)});
    return false;
  }
}

function syncSubSettings() {
  const dl = $('[data-set="alerts.deadlines"]'), gr = $('[data-set="alerts.grades"]'), gv = $('[data-set="grades_show_value"]');
  const rem = $("#reminders");
  rem.disabled = !dl.checked;
  $('[data-parent="deadlines"]').classList.toggle("is-off", !dl.checked);
  gv.disabled = !gr.checked;
  $('[data-parent="grades"]').classList.toggle("is-off", !gr.checked || !gv.checked);
  const content = $('[data-set="alerts.content"]');
  content.closest(".setting").classList.toggle("is-off", !content.checked);
}

function settingsChange(el) {
  if (el.name === "theme") {
    el.value === "system" ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = el.value);
    store.set("theme", el.value === "system" ? null : el.value);
    toast(`Theme set to ${THEMES.find(([v]) => v === el.value)[1]}`);
    return;
  }
  if (el.hasAttribute("data-autostart")) {
    api("/autostart", {enabled: el.checked}).then((r) => { el.checked = r.enabled; toast(r.enabled ? "ACT Companion will start when you log in" : "Start at login turned off"); })
      .catch((e) => toast("Couldn't change start at login. " + e.message, {error: true}));
    return;
  }
  if (el.name === "watch" || el.hasAttribute("data-watch")) {
    const all = $('input[name="watch"][value="all"]').checked;
    $("#watchlist").hidden = all;
    const ids = $$("[data-watch]").filter((x) => x.checked).map((x) => Number(x.dataset.watch));
    if (!all && !ids.length) { toast("Pick at least one course, or choose All courses.", {error: true}); return; }
    saveSettings({watch_courses: all ? null : ids});
    return;
  }
  if (el.id === "reminders") {
    const parts = el.value.split(",").map((x) => x.trim()).filter(Boolean);
    const hours = parts.map(Number);
    const bad = !parts.length || hours.some((h) => !isFinite(h) || h <= 0 || h > 168);
    el.setAttribute("aria-invalid", String(bad));
    if (!bad) saveSettings({reminder_hours: hours}).then(() => { el.value = S.status.settings.reminder_hours.join(", "); });
    return;
  }
  const key = el.dataset.set;
  if (!key) return;
  if (key.startsWith("alerts.")) {
    syncSubSettings();
    saveSettings({alerts: {[key.slice(7)]: el.checked}});
  } else if (key === "grades_show_value") {
    syncSubSettings();
    saveSettings({grades_show_value: el.checked});
  } else {
    saveSettings({[key]: Number(el.value)});
  }
}

// Course order: up/down buttons, drag by the handle, Esc cancels a drag.
function saveCourseOrder() {
  const ids = $$("#colist .co-row").map((li) => Number(li.dataset.id));
  saveSettings({course_order: ids}).then(() => refreshMoveButtons());
}
function refreshMoveButtons() {
  const rows = $$("#colist .co-row");
  rows.forEach((li, i) => { $('[data-action="co-up"]', li).disabled = i === 0; $('[data-action="co-down"]', li).disabled = i === rows.length - 1; });
}
function moveCourse(li, dir) {
  const target = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (!target || !target.classList.contains("co-row")) return;
  dir < 0 ? target.before(li) : target.after(li);
  refreshMoveButtons();
  const btn = $(`[data-action="${dir < 0 ? "co-up" : "co-down"}"]`, li);
  (btn.disabled ? $(`[data-action="${dir < 0 ? "co-down" : "co-up"}"]`, li) : btn).focus();
  saveCourseOrder();
}
function toggleSwatches(btn) {
  const li = btn.closest(".co-row");
  const open = btn.getAttribute("aria-expanded") === "true";
  $$("#colist .swatch-pop").forEach((p) => p.remove());
  $$("#colist .co-color").forEach((b) => b.setAttribute("aria-expanded", "false"));
  if (open) return;
  const id = Number(li.dataset.id), cur = S.color[id] || 1, code = esc(shortName(courseById(id)));
  btn.setAttribute("aria-expanded", "true");
  li.insertAdjacentHTML("beforeend", `<div class="swatch-pop" role="radiogroup" aria-label="Color for ${code}">${COLOR_NAMES.map((name, i) =>
    `<button class="swatch-opt c${i + 1}" type="button" role="radio" aria-checked="${i + 1 === cur}" tabindex="${i + 1 === cur ? 0 : -1}" aria-label="${name}" data-swatch="${i + 1}"></button>`).join("")}
    <span class="swatch-name">${COLOR_NAMES[cur - 1]}</span></div>`);
  $(`[data-swatch="${cur}"]`, li).focus();
}
function pickSwatch(btn) {
  const li = btn.closest(".co-row"), id = Number(li.dataset.id), slot = Number(btn.dataset.swatch);
  const colors = {...(S.status.settings.course_colors || {}), [id]: slot};
  li.className = li.className.replace(/\bc\d\b/, "c" + slot);
  $$(".swatch-opt", li).forEach((b) => { b.setAttribute("aria-checked", String(b === btn)); b.tabIndex = b === btn ? 0 : -1; });
  $(".swatch-name", li).textContent = COLOR_NAMES[slot - 1];
  $(".co-color", li).setAttribute("aria-label", `Color for ${shortName(courseById(id))}: ${COLOR_NAMES[slot - 1]}`);
  saveSettings({course_colors: colors});
}

let drag = null;
function dragStart(ev) {
  const handle = ev.target.closest("[data-handle]");
  if (!handle) return;
  ev.preventDefault();
  const li = handle.closest(".co-row");
  drag = {li, next: li.nextElementSibling, drop: document.createElement("li")};
  drag.drop.className = "co-drop";
  drag.drop.setAttribute("aria-hidden", "true");
  li.classList.add("is-dragging");
  handle.setPointerCapture(ev.pointerId);
}
function dragMove(ev) {
  if (!drag) return;
  const rows = $$("#colist .co-row").filter((r) => r !== drag.li);
  const before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
  before ? before.before(drag.drop) : $("#colist").append(drag.drop);
}
function dragEnd(cancel) {
  if (!drag) return;
  const {li, next, drop} = drag;
  const before = $$("#colist .co-row").map((x) => x.dataset.id).join();
  drag = null;
  li.classList.remove("is-dragging");
  if (!cancel && drop.isConnected) drop.replaceWith(li);
  else if (next) next.before(li);
  drop.remove();
  refreshMoveButtons();
  if (!cancel && $$("#colist .co-row").map((x) => x.dataset.id).join() !== before) saveCourseOrder();
}

async function checkNow(btn) {
  const before = (S.status.watcher || {}).last_run;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Checking';
  try {
    await api("/check-now", {});
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = await api("/status");
      if (st.watcher.last_run !== before) { S.status = st; break; }
    }
  } catch (e) { toast("Couldn't check. " + e.message, {error: true}); }
  const line = $("#statusline");
  if (line) line.innerHTML = statusLine(S.status.watcher);
  btn.disabled = false;
  btn.innerHTML = `${ic("retry", "icon-sm")}Check now`;
  renderCounts();
}

function confirmDialog(title, text, okLabel) {
  const dlg = $("#dlg");
  dlg.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="dialog-actions">
    <button class="btn btn-secondary" value="cancel">Cancel</button><button class="btn btn-danger" value="ok">${esc(okLabel)}</button></div></form>`;
  return new Promise((resolve) => {
    dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), {once: true});
    dlg.showModal();
    $('button[value="cancel"]', dlg).focus();
  });
}

// ---- Search palette ----------------------------------------------------------------------------

const P = {shown: [], sel: 0, files: null, filesAt: 0, loading: false, returnFocus: null};

function paletteBase() {
  const out = NAV.map((n) => ({group: "Pages", label: n.label, href: n.href, icon: n.icon}));
  for (const c of S.courses) out.push({group: "Courses", label: courseTitle(c), code: shortName(c), cid: c.id, href: `#/courses/${c.id}`, icon: "book"});
  for (const e of S.deadlines || []) {
    if (e.timesort < nowS() && !isOpenDeadline(e)) continue;
    out.push({group: "Deadlines", label: e.activityname || e.name, sub: `${shortName(e.course)} · ${fmtDue(e.timesort, true)}`,
      href: (e.action && e.action.url) || e.url, external: true, icon: "assignment"});
  }
  return out;
}

async function loadFileIndex() {
  if (P.loading || (P.files && Date.now() - P.filesAt < 10 * 60000)) return;
  P.loading = true;
  try {
    const lists = await Promise.all(S.courses.map((c) => api("/course/" + c.id).then((secs) => [c, secs]).catch(() => [c, []])));
    const files = [];
    for (const [c, secs] of lists) for (const s of secs) for (const m of s.modules || []) {
      if (m.modname === "label" || m.modname === "subsection") continue;
      const info = modInfo(m);
      const kind = info.single ? EXT_LABEL(info.single.filename) : MOD_LABEL[m.modname] || m.modname;
      files.push({group: "Files and activities", label: m.name, sub: `${kind} · ${shortName(c)} · ${s.name}`,
        href: info.single ? info.single.fileurl : m.url, external: true, icon: info.single ? "file" : KIND_ICON[m.modname] || "file"});
    }
    P.files = files;
    P.filesAt = Date.now();
  } finally {
    P.loading = false;
  }
  if (!$("#palette").hidden) renderPalette();
}

function openPalette() {
  const pal = $("#palette");
  if (!pal) return;
  P.returnFocus = document.activeElement;
  pal.hidden = false;
  $(".app").inert = true;
  $("#pq").value = "";
  P.sel = 0;
  if (!S.deadlines) getDeadlines().then(() => renderPalette()).catch(() => {});
  renderPalette();
  $("#pq").focus();
  loadFileIndex();
}
function closePalette(restore = true) {
  const pal = $("#palette");
  if (!pal || pal.hidden) return;
  pal.hidden = true;
  $(".app").inert = false;
  if (restore && P.returnFocus && P.returnFocus.focus) P.returnFocus.focus();
}

function renderPalette() {
  const q = $("#pq").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  let pool = paletteBase();
  if (q) pool = pool.concat(P.files || []);
  const hay = (it) => (it.label + " " + (it.code || "") + " " + (it.sub || "")).toLowerCase();
  let shown = q ? pool.filter((it) => words.every((w) => hay(it).includes(w))) : pool.filter((it) => it.group !== "Deadlines").concat(pool.filter((it) => it.group === "Deadlines").slice(0, 5));
  shown = shown.slice(0, 60);
  P.shown = shown;
  P.sel = Math.min(P.sel, Math.max(0, shown.length - 1));
  let group = "";
  const html = shown.map((it, i) => {
    const head = it.group !== group ? `<div class="palette-group">${esc(it.group)}</div>` : "";
    group = it.group;
    const label = it.code ? `<span class="code ${cc(it.cid)}">${esc(it.code)}</span> ${esc(it.label)}` : esc(it.label);
    return `${head}<div class="palette-item" role="option" id="pi${i}" data-i="${i}" aria-selected="${i === P.sel}">${ic(it.icon)}
      <span>${label}${it.sub ? ` <span class="muted">${esc(it.sub)}</span>` : ""}</span>${i === P.sel ? '<span class="kbd">Enter</span>' : ""}</div>`;
  }).join("");
  const loadingNote = q && P.loading ? '<div class="palette-group">Loading course files...</div>' : "";
  $("#presults").innerHTML = (html + loadingNote) || '<div class="palette-group">No results. Try a course code, file name or deadline.</div>';
  $("#pq").setAttribute("aria-activedescendant", shown.length ? "pi" + P.sel : "");
}
function movePalette(delta) {
  if (!P.shown.length) return;
  P.sel = (P.sel + delta + P.shown.length) % P.shown.length;
  renderPalette();
  const cur = $("#pi" + P.sel);
  if (cur) cur.scrollIntoView({block: "nearest"});
}
function activatePalette(i) {
  const it = P.shown[i];
  if (!it || !it.href) return;
  closePalette(false);
  if (it.href.startsWith("#")) location.hash = it.href;
  else window.open(it.href, "_blank", "noopener");
}

// ---- events ------------------------------------------------------------------------------------

const ACTIONS = {
  palette: openPalette,
  retry: () => route(),
  later: () => { const l = $$("[data-group]").pop(); if (l) l.scrollIntoView({block: "start"}); },
  "toggle-all": () => {
    const secs = $$("#secs .section");
    const anyOpen = secs.some((s) => $(".section-toggle", s).getAttribute("aria-expanded") === "true");
    secs.forEach((s) => setSection(s, !anyOpen));
    syncToggleAll();
  },
  markread: async () => {
    const before = S.unread.notifications;
    await api("/notifications/read", {});
    S.unread.notifications = 0;
    renderCounts();
    toast(`Marked ${before || "all"} as read`);
    route();
  },
  check: (el) => checkNow(el),
  test: async () => { const r = await api("/test-notification", {}); r.ok ? toast("Test alert sent. Check your desktop notifications.") : toast("Couldn't show an alert on this system.", {error: true}); },
  signout: async () => {
    if (!(await confirmDialog("Sign out?", "Alerts stop until you sign in again, and this app's history for your account is deleted.", "Sign out"))) return;
    await api("/logout", {});
    loginPage(false);
  },
  quit: async () => {
    if (!(await confirmDialog("Quit ACT Companion?", "Background checks and desktop alerts stop until you open it again.", "Quit"))) return;
    await api("/quit", {});
    S.status = null;
    stoppedPage();
  },
  "co-up": (el) => moveCourse(el.closest(".co-row"), -1),
  "co-down": (el) => moveCourse(el.closest(".co-row"), 1),
  "co-color": (el) => toggleSwatches(el),
  "co-reset": async () => {
    if (await saveSettings({course_order: [], course_colors: {}}, "Order and colors reset")) route();
  },
};

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-action]");
  if (a) {
    if (a.dataset.action === "palette-bg") { if (ev.target === a) closePalette(); return; }
    ev.preventDefault();
    const fn = ACTIONS[a.dataset.action];
    if (fn) Promise.resolve(fn(a)).catch((e) => toast(e.message, {error: true}));
    return;
  }
  const go = ev.target.closest("[data-go]");
  if (go) { location.hash = go.dataset.go; return; }
  const wk = ev.target.closest("[data-week]");
  if (wk) { location.hash = "#/planner" + (Number(wk.dataset.week) ? "?week=" + wk.dataset.week : ""); return; }
  const sec = ev.target.closest(".section-toggle");
  if (sec) { setSection(sec.closest(".section"), sec.getAttribute("aria-expanded") !== "true"); syncToggleAll(); return; }
  const sw = ev.target.closest("[data-swatch]");
  if (sw) { pickSwatch(sw); return; }
  const item = ev.target.closest(".palette-item");
  if (item) { activatePalette(Number(item.dataset.i)); return; }
  const dl = ev.target.closest("[data-download]");
  if (dl) toast(`Downloading ${dl.dataset.download}`, {icon: "download"});
  const note = ev.target.closest("[data-note]");
  if (note) { // opening a notification marks it read
    const id = Number(note.dataset.note);
    note.removeAttribute("data-note");
    note.classList.add("is-read");
    S.unread.notifications = Math.max(0, (S.unread.notifications || 0) - 1);
    renderCounts();
    api("/notification/read", {id}).catch(() => {});
  }
});

document.addEventListener("input", (ev) => {
  if (ev.target.id === "filter") { clearTimeout(filterTimer); const v = ev.target.value; filterTimer = setTimeout(() => filterContent(v), 100); }
  if (ev.target.id === "pq") { P.sel = 0; renderPalette(); }
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "dlcourse") return filterDeadlines(ev.target.value);
  if (ev.target.closest(".main-narrow")) settingsChange(ev.target);
});
document.addEventListener("pointerdown", dragStart);
document.addEventListener("pointermove", dragMove);
document.addEventListener("pointerup", () => dragEnd(false));
document.addEventListener("pointercancel", () => dragEnd(true));
document.addEventListener("mousemove", (ev) => {
  const it = ev.target.closest && ev.target.closest(".palette-item");
  if (it && Number(it.dataset.i) !== P.sel) { P.sel = Number(it.dataset.i); renderPalette(); }
});

document.addEventListener("keydown", (ev) => {
  const pal = $("#palette"), open = pal && !pal.hidden;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); open ? closePalette() : openPalette(); return; }
  if (open) {
    if (ev.key === "Escape") { ev.preventDefault(); closePalette(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); movePalette(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); movePalette(-1); }
    else if (ev.key === "Enter") { ev.preventDefault(); activatePalette(P.sel); }
    return;
  }
  if (ev.key === "Escape" && drag) { dragEnd(true); return; }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName);
  if (ev.key === "/" && !typing && pal) { ev.preventDefault(); openPalette(); return; }
  // Planner: Alt+Left / Alt+Right change week.
  if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight") && location.hash.startsWith("#/planner")) {
    ev.preventDefault();
    const cur = parseInt(parseHash().q.week || "0", 10) || 0, next = cur + (ev.key === "ArrowLeft" ? -1 : 1);
    location.hash = "#/planner" + (next ? "?week=" + next : "");
    return;
  }
  // Tabs and color swatches: arrow keys move between options.
  const tab = ev.target.closest && ev.target.closest('[role="tab"]');
  if (tab && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
    const tabs = $$('[role="tab"]', tab.parentElement), i = tabs.indexOf(tab) + (ev.key === "ArrowLeft" ? -1 : 1);
    const next = tabs[(i + tabs.length) % tabs.length];
    next.focus();
    next.click();
    return;
  }
  const sw = ev.target.closest && ev.target.closest("[data-swatch]");
  if (sw && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
    ev.preventDefault();
    const all = $$("[data-swatch]", sw.parentElement), i = all.indexOf(sw) + (ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1);
    all[(i + all.length) % all.length].focus();
  }
});

window.addEventListener("hashchange", route);

// Background refreshes: unread counts and check status every minute; course-change items every 20 seconds when that alert is on.
setInterval(async () => {
  if (!S.status || !$("#view")) return;
  refreshUnread();
  try { const st = await api("/status"); S.status.watcher = st.watcher; renderCounts(); } catch (e) { /* app restarting */ }
}, 60000);
setInterval(async () => {
  if (!contentAlertsOn() || recentSig === null || !$("#view")) return;
  const m = location.hash.match(/^#\/courses\/(\d+)(\/content)?$/);
  const onHome = !location.hash || location.hash === "#/";
  if (!m && !onHome) return;
  try {
    const r = await api("/recent" + (m ? "?course=" + m[1] : ""));
    if (sigOf(r) !== recentSig) { toast("New items in your courses"); forceFresh = true; route(); }
  } catch (e) { /* app restarting, try again next tick */ }
}, 20000);

boot();
