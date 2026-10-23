"use strict";
/* ACT Companion UI. Plain JavaScript, no build step. Runs under a strict CSP, so there are no
   inline scripts or inline event handlers: every interaction goes through the delegated
   listeners at the bottom of this file. */

const BASE = "https://activity.act.edu";

// ---- helpers ----------------------------------------------------------------------------------

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
// DOMParser documents are inert (no script or handler execution), unlike innerHTML on a live element.
const strip = (h) => (new DOMParser().parseFromString(h || "", "text/html").body.textContent || "").trim();
const nowS = () => Date.now() / 1000;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const rtf = new Intl.RelativeTimeFormat(undefined, {numeric: "auto"});
function relTime(ts) {
  const d = ts - nowS(), a = Math.abs(d);
  if (a < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(d / 3600), "hour");
  if (a < 14 * 86400) return rtf.format(Math.round(d / 86400), "day");
  return rtf.format(Math.round(d / (7 * 86400)), "week");
}
const fmtWhen = (t) => new Date(t * 1000).toLocaleString([], {weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit"});
const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
const fmtDayLong = (d) => d.toLocaleDateString([], {weekday: "long", day: "numeric", month: "long"});
const fmtSize = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const COLORS = ["#6366f1", "#0d9488", "#d97706", "#e11d48", "#059669", "#0284c7", "#9333ea", "#ea580c"];

// ---- icons (24px stroke icons) --------------------------------------------------------------

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  book: '<path d="M2 4.5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4.5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>',
  message: '<path d="M21 14.5a2 2 0 0 1-2 2H8l-5 4.5V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  paperclip: '<path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
};
const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
const brandMark = () => `<span class="brand-mark">${icon("book")}</span>`;

// ---- app state and API ---------------------------------------------------------------------

const S = {status: null, courses: [], grades: {}, gradesAt: 0, unread: {notifications: 0, messages: 0}, deadlines: null, deadlinesAt: 0};
let routeToken = 0;
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

// ---- course naming and colors ----------------------------------------------------------------

const courseById = (id) => S.courses.find((c) => c.id === Number(id));
function courseColor(id) {
  const i = S.courses.findIndex((c) => c.id === Number(id));
  return COLORS[(i < 0 ? Number(id) || 0 : i) % COLORS.length];
}
const shortName = (c) => ((c && c.shortname) || "").split("_")[0].trim() || (c && c.fullname) || "Course";
// "Computer Science 192: Object Oriented Programming with Python - FALL 2026 (V)" -> "Object Oriented Programming with Python"
function courseTitle(c) {
  const full = (c && c.fullname) || "";
  const t = full.replace(/\s+-\s+(FALL|SPRING|SUMMER|WINTER)\b.*$/i, "").replace(/^[^:]{2,60}?\d{2,4}[A-Z]?\s*:\s*/, "");
  return t || full;
}
function courseTerm(c) {
  const m = ((c && c.fullname) || "").match(/\b(FALL|SPRING|SUMMER|WINTER)\s+(\d{4})/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + " " + m[2] : "";
}
const codeBadge = (c, cls = "") => `<span class="code ${cls}" style="--c:${courseColor(c && c.id)}">${esc(shortName(c))}</span>`;

// ---- files ------------------------------------------------------------------------------------

const EXT_KIND = {pdf: "pdf", doc: "doc", docx: "doc", odt: "doc", rtf: "doc", ppt: "ppt", pptx: "ppt", odp: "ppt", key: "ppt",
  xls: "xls", xlsx: "xls", csv: "xls", ods: "xls", py: "code", java: "code", js: "code", ts: "code", c: "code", cpp: "code",
  h: "code", ipynb: "code", html: "code", css: "code", txt: "code", md: "code", json: "code", sql: "code",
  zip: "zip", rar: "zip", "7z": "zip", tar: "zip", gz: "zip", png: "img", jpg: "img", jpeg: "img", gif: "img",
  svg: "img", webp: "img", mp4: "img", mov: "img", mp3: "img"};
const fileExt = (name) => (name && name.includes(".") ? name.split(".").pop().toLowerCase() : "");
const fileKind = (name) => EXT_KIND[fileExt(name)] || "other";
const extTile = (name) => `<span class="ext ${fileKind(name)}">${esc((fileExt(name) || "file").toUpperCase().slice(0, 4))}</span>`;
const MOD = {assign: ["Assignment", "clipboard"], quiz: ["Quiz", "check"], forum: ["Forum", "message"], page: ["Page", "file"],
  folder: ["Folder", "folder"], url: ["Link", "link"], resource: ["File", "file"], book: ["Book", "book"], lti: ["External tool", "external"],
  h5pactivity: ["Interactive content", "spark"], choice: ["Choice", "check"], feedback: ["Feedback", "message"], glossary: ["Glossary", "book"],
  lesson: ["Lesson", "book"], scorm: ["SCORM package", "file"], wiki: ["Wiki", "book"], workshop: ["Workshop", "clipboard"],
  data: ["Database", "folder"], bigbluebuttonbn: ["Online meeting", "message"]};

// ---- small UI pieces -------------------------------------------------------------------------

const sk = (h, extra = "") => `<div class="sk" style="height:${h}px;${extra}"></div>`;
const emptyState = (ic, title, sub = "") => `<div class="empty"><div class="ico-c">${icon(ic, "lg")}</div><b>${esc(title)}</b>${sub ? esc(sub) : ""}</div>`;

function toast(msg, bad = false) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.innerHTML = icon(bad ? "alert" : "check") + `<span>${esc(msg)}</span>`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3200);
}

// Moodle-provided HTML is rendered in a sandboxed iframe with scripts disabled, never injected into the page.
function htmlBox(html) {
  const f = document.createElement("iframe");
  f.className = "html";
  f.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  f.srcdoc = `<base target="_blank"><style>body{margin:0;font:14px/1.55 system-ui,"Segoe UI",sans-serif;color:${cssVar("--ink")};background:transparent}
    a{color:${cssVar("--accent")}}img{max-width:100%;height:auto}p:first-child{margin-top:0}p:last-child{margin-bottom:0}</style>${html || ""}`;
  f.addEventListener("load", () => { f.style.height = (f.contentDocument.documentElement.scrollHeight + 2) + "px"; });
  return f;
}

function setHeader(title, crumbs = []) {
  $("#title").textContent = title;
  $("#crumbs").innerHTML = crumbs.map(([label, href]) => href ? `<a href="${href}">${esc(label)}</a>` : esc(label)).join(" / ");
  document.title = title + " - ACT Companion";
}
const paint = (t, html) => { if (!stale(t)) $("#view").innerHTML = html; return !stale(t); };

// ---- data loaders (lightly cached on the client) -------------------------------------------

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
  try {
    S.unread = await api("/unread");
    renderNavCounts();
  } catch (e) { /* counts are a nicety; keep the last ones */ }
  return S.unread;
}
const isOpenDeadline = (e) => !(e.action && e.action.actionable === false);

// ---- boot, sign in ---------------------------------------------------------------------------

async function boot() {
  try {
    S.status = await api("/status");
  } catch (e) {
    return e.kind === "session" ? sessionPage() : fatal(e);
  }
  if (!S.status.logged_in) return loginPage(S.status.expired);
  try {
    S.courses = await api("/courses");
  } catch (e) {
    return e.kind === "login" ? loginPage(true) : fatal(e);
  }
  renderShell();
  refreshUnread();
  route();
}

function fatal(e) {
  $("#app").innerHTML = `<div class="auth"><div class="card auth-card">${emptyState("alert", "Something went wrong", e.message)}
    <button class="btn primary block" data-action="reload">Try again</button></div></div>`;
}

function sessionPage() {
  $("#app").innerHTML = `<div class="auth"><div class="card auth-card">
    <div class="brand">${brandMark()}<span>ACT Companion</span></div>
    <h2>Open ACT Companion from the app</h2>
    <p class="mute">For your security this page only works when it is opened from the ACT Companion shortcut,
    or by running <code>act-companion</code>. Open it that way and this tab will be replaced.</p></div></div>`;
}

function loginPage(expired) {
  S.status = null;
  $("#app").innerHTML = `<div class="auth"><form class="card auth-card" id="login">
    <div class="brand">${brandMark()}<span>ACT Companion</span></div>
    <h2>Sign in</h2>
    <p class="mute">Use the same username and password as activity.act.edu.</p>
    ${expired ? '<div class="notice warn">Your session expired. Please sign in again.</div>' : ""}
    <label class="field" for="u">Username</label><input class="input" id="u" autocomplete="username" required>
    <label class="field" for="p">Password</label><input class="input" type="password" id="p" autocomplete="current-password" required>
    <button class="btn primary block" type="submit">Sign in</button>
    <p class="err" id="loginerr" role="alert"></p>
    <div class="fine">${icon("lock")}<span>Your password goes straight to activity.act.edu and is never stored. Only the access token it
    returns is kept, in your system keychain. Unofficial app, not affiliated with or endorsed by the school.</span></div>
  </form></div>`;
  $("#u").focus();
  $("#login").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Signing in...";
    $("#loginerr").textContent = "";
    try {
      await api("/login", {username: $("#u").value, password: $("#p").value});
      $("#p").value = "";
      location.hash = "#/";
      boot();
    } catch (e) {
      $("#loginerr").textContent = /invalid login/i.test(e.message) ? "Wrong username or password." : e.message;
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
}

// ---- shell -----------------------------------------------------------------------------------

const NAV = [
  {key: "", href: "#/", label: "Home", icon: "home"},
  {key: "deadlines", href: "#/deadlines", label: "Deadlines", icon: "calendar"},
  {key: "courses", href: "#/courses", label: "Courses", icon: "book"},
  {key: "grades", href: "#/grades", label: "Grades", icon: "chart"},
  {key: "messages", href: "#/messages", label: "Messages", icon: "message", count: "messages"},
  {key: "notifications", href: "#/notifications", label: "Notifications", icon: "bell", count: "notifications"},
  {key: "settings", href: "#/settings", label: "Settings", icon: "sliders"},
];

function renderShell() {
  const u = S.status.user || {};
  $("#app").innerHTML = `
  <div class="shell" id="shell">
    <aside class="sidebar" aria-label="Sidebar">
      <a class="brand" href="#/">${brandMark()}<span>ACT Companion</span></a>
      <nav class="nav" id="nav" aria-label="Main"></nav>
      <div class="side-label">Your courses</div>
      <nav class="nav side-courses" id="sidecourses" aria-label="Courses"></nav>
      <div class="side-foot">
        <span class="avatar">${esc(initials(u.fullname))}</span>
        <span class="who grow"><b>${esc(u.fullname || "")}</b><span class="mute">activity.act.edu</span></span>
        <button class="icon-btn sm" data-action="theme" id="themebtn" title="Switch light or dark theme" aria-label="Switch theme"></button>
      </div>
    </aside>
    <div class="scrim" data-action="closenav"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-action="opennav" aria-label="Open menu">${icon("menu")}</button>
        <div class="titles grow"><div class="crumbs" id="crumbs"></div><h1 id="title"></h1></div>
        <button class="search-btn" data-action="palette" aria-label="Search">${icon("search")}<span class="label">Search courses, files, deadlines</span><kbd>Ctrl K</kbd></button>
        <button class="icon-btn" data-action="refresh" title="Refresh" aria-label="Refresh">${icon("refresh")}</button>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>
  <div class="palette-backdrop" id="palette" data-action="closepalette-bg">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search">
      <div class="palette-in">${icon("search")}<input id="pq" placeholder="Search courses, files, deadlines and pages" autocomplete="off" spellcheck="false" aria-controls="presults"></div>
      <div class="results" id="presults" role="listbox"></div>
      <div class="palette-foot"><span><kbd>&uarr;</kbd><kbd>&darr;</kbd>move</span><span><kbd>Enter</kbd>open</span><span><kbd>Esc</kbd>close</span></div>
    </div>
  </div>`;
  renderThemeBtn();
}

function renderNav(key, sub) {
  $("#nav").innerHTML = NAV.map((n) => `<a href="${n.href}" ${n.key === key ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${n.label}</span>${n.count ? `<span class="count" data-count="${n.count}" hidden></span>` : ""}</a>`).join("");
  $("#sidecourses").innerHTML = S.courses.map((c) => `<a href="#/courses/${c.id}" title="${esc(c.fullname)}" ${key === "courses" && String(c.id) === sub ? 'aria-current="page"' : ""}>
    <span class="dot" style="--c:${courseColor(c.id)}"></span><span class="ellipsis grow">${esc(shortName(c))}</span></a>`).join("");
  renderNavCounts();
}

function renderNavCounts() {
  for (const el of $$("[data-count]")) {
    const n = S.unread[el.dataset.count] || 0;
    el.hidden = !n;
    el.textContent = n > 99 ? "99+" : n;
  }
}

const currentTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function renderThemeBtn() {
  const b = $("#themebtn");
  if (b) b.innerHTML = icon(currentTheme() === "dark" ? "sun" : "moon");
}
function toggleTheme() {
  const t = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (e) { /* not persisted, still applied */ }
  renderThemeBtn();
}

// ---- router ----------------------------------------------------------------------------------

let forceFresh = false;
async function route() {
  if (!S.status) return;
  const t = ++routeToken;
  const [a = "", b, c] = (location.hash || "#/").replace(/^#\/?/, "").split("/");
  $("#shell").classList.remove("nav-open");
  renderNav(a, b);
  window.scrollTo(0, 0);
  const views = {
    "": () => homePage(t),
    deadlines: () => deadlinesPage(t),
    courses: () => (b ? coursePage(t, b, c || "content") : coursesPage(t)),
    grades: () => (b ? (location.hash = `#/courses/${b}/grades`) : gradesPage(t)),
    messages: () => messagesPage(t, b),
    notifications: () => notificationsPage(t),
    settings: () => settingsPage(t),
  };
  try {
    await (views[a] || (() => notFound(t)))();
  } catch (e) {
    if (stale(t)) return;
    if (e.kind === "login") return loginPage(true);
    if (e.kind === "session") return sessionPage();
    paint(t, `<div class="card">${emptyState("alert", "Could not load this page", e.message)}
      <div style="text-align:center;margin-top:4px"><button class="btn" data-action="retry">${icon("refresh")} Try again</button></div></div>`);
  }
}

function notFound(t) {
  setHeader("Not found");
  paint(t, `<div class="card">${emptyState("search", "That page does not exist", "")}<div style="text-align:center"><a class="btn" href="#/">Go home</a></div></div>`);
}

// ---- home ------------------------------------------------------------------------------------

function deadlineItem(e) {
  const c = e.course || {}, left = e.timesort - nowS();
  const cls = left < 0 ? "danger" : left < 86400 ? "warn" : left < 3 * 86400 ? "accent" : "";
  const d = new Date(e.timesort * 1000);
  return `<a class="item" href="${esc((e.action && e.action.url) || e.url || BASE)}" target="_blank" rel="noopener">
    <span class="when"><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString([], {month: "short"}))}</span></span>
    <span class="grow"><span class="t">${esc(e.activityname || e.name)}</span>
      <span class="sub">${codeBadge(c)}<span>${esc(fmtWhen(e.timesort))}</span>${e.action && e.action.name ? `<span>&middot; ${esc(e.action.name)}</span>` : ""}</span></span>
    <span class="chip ${cls}">${left < 0 ? "Overdue" : esc(relTime(e.timesort))}</span></a>`;
}

function notifItem(n) {
  return `<a class="item ${n.read ? "" : "unread"}" href="${esc(n.contexturl || BASE)}" target="_blank" rel="noopener">
    <span class="ico-c">${icon("bell")}</span>
    <span class="grow"><span class="t">${esc(n.subject)}</span><span class="sub">${esc(relTime(n.timecreated))}</span></span></a>`;
}

function courseRow(c) {
  const g = S.grades[c.id];
  return `<a class="item" href="#/courses/${c.id}">${codeBadge(c, "lg")}
    <span class="grow"><span class="t">${esc(courseTitle(c))}</span><span class="sub">${esc(courseTerm(c))}</span></span>
    ${g && g !== "-" ? `<span class="chip">${esc(g)}</span>` : ""}</a>`;
}

function recentCard(r, withCourse) {
  if (!r || !r.recent || !r.recent.length) return "";
  return `<section class="card flush recent"><div class="card-h"><h3>${icon("spark")} New in your courses</h3>
    <span class="mute">checked ${esc(r.checked ? relTime(r.checked) : "not yet")}</span></div><div class="list">
    ${r.recent.slice(0, 8).map((i) => `<a class="item" href="${esc(i.fileurl || i.url)}" target="_blank" rel="noopener">
      ${i.fileurl ? extTile(i.label) : `<span class="ico-c">${icon("file")}</span>`}
      <span class="grow"><span class="t">${esc(i.label)}</span><span class="sub">${withCourse ? codeBadge(courseById(i.course) || {id: i.course}) : ""}<span>${esc(i.title)}</span></span></span>
      <span class="chip accent">${esc(relTime(i.detected))}</span></a>`).join("")}</div></section>`;
}

let recentSig = null;
const sigOf = (r) => ((r && r.recent) || []).map((i) => i.detected + i.label).join("|");

async function homePage(t) {
  setHeader("Home");
  paint(t, `<div class="stack">${sk(104)}<div class="stats">${sk(78)}${sk(78)}${sk(78)}${sk(78)}</div><div class="cols">${sk(320)}${sk(320)}</div></div>`);
  const watchContent = S.status.settings.alerts.content;
  const [events, notes, unread, recent] = await Promise.all([
    getDeadlines(forceFresh), api("/notifications"), refreshUnread(), watchContent ? api("/recent") : null, getGrades(forceFresh)]);
  forceFresh = false;
  if (stale(t)) return;
  recentSig = watchContent ? sigOf(recent) : null;
  const n = nowS();
  const upcoming = events.filter((e) => e.timesort >= n);
  const overdue = events.filter((e) => e.timesort < n && isOpenDeadline(e));
  const week = upcoming.filter((e) => e.timesort - n < 7 * 86400);
  const upNext = overdue.concat(upcoming).slice(0, 6);
  const h = new Date().getHours();
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = ((S.status.user && S.status.user.fullname) || "").split(" ")[0];
  const summary = (week.length ? `${plural(week.length, "deadline")} in the next 7 days` : "Nothing due in the next 7 days")
    + (overdue.length ? `, ${overdue.length} overdue` : "") + ".";
  const stat = (ic, num, label, href, cls = "") => `<a class="card stat ${cls}" href="${href}"><span class="ico-c">${icon(ic)}</span><span><div class="num">${num}</div><div class="lbl">${label}</div></span></a>`;
  paint(t, `<div class="stack">
    <section class="hero"><h2>${hello}${first ? ", " + esc(first) : ""}</h2><p>${esc(fmtDayLong(new Date()))}. ${esc(summary)}</p></section>
    ${recentCard(recent, true)}
    <div class="stats">
      ${stat("calendar", week.length, "due this week", "#/deadlines", week.length ? "warn" : "ok")}
      ${stat("clock", overdue.length, "overdue", "#/deadlines", overdue.length ? "danger" : "ok")}
      ${stat("bell", unread.notifications, "unread notifications", "#/notifications")}
      ${stat("message", unread.messages, "unread messages", "#/messages")}
    </div>
    <div class="cols">
      <section class="card flush"><div class="card-h"><h3>${icon("calendar")} Up next</h3><a href="#/deadlines">All deadlines</a></div>
        <div class="list">${upNext.map(deadlineItem).join("") || emptyState("check", "You're all caught up", "Nothing is due soon.")}</div></section>
      <div class="stack">
        <section class="card flush"><div class="card-h"><h3>${icon("book")} Your courses</h3><a href="#/courses">View all</a></div>
          <div class="list">${S.courses.map(courseRow).join("") || emptyState("book", "No courses yet")}</div></section>
        <section class="card flush"><div class="card-h"><h3>${icon("bell")} Latest notifications</h3><a href="#/notifications">View all</a></div>
          <div class="list">${(notes.notifications || []).slice(0, 4).map(notifItem).join("") || emptyState("bell", "No notifications")}</div></section>
      </div>
    </div></div>`);
}

// ---- deadlines -------------------------------------------------------------------------------

async function deadlinesPage(t) {
  setHeader("Deadlines");
  paint(t, `<div class="stack">${sk(180)}${sk(180)}</div>`);
  const events = await getDeadlines(forceFresh);
  forceFresh = false;
  if (stale(t)) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = today.getTime() / 1000, n = nowS();
  const groups = [["Overdue", []], ["Today", []], ["Tomorrow", []], ["Next 7 days", []], ["Later", []]];
  for (const e of events) {
    if (e.timesort < n) { if (isOpenDeadline(e)) groups[0][1].push(e); continue; }
    const day = Math.floor((e.timesort - start) / 86400);
    groups[day <= 0 ? 1 : day === 1 ? 2 : day < 7 ? 3 : 4][1].push(e);
  }
  const html = groups.filter(([, list]) => list.length).map(([name, list]) => `<section class="card flush">
    <div class="card-h"><h3>${name === "Overdue" ? icon("alert") : icon("calendar")} ${name}</h3><span class="chip ${name === "Overdue" ? "danger" : ""}">${list.length}</span></div>
    <div class="list">${list.map(deadlineItem).join("")}</div></section>`).join("");
  paint(t, `<div class="stack">${html || `<div class="card">${emptyState("check", "You're all caught up", "No upcoming deadlines in your courses.")}</div>`}
    <p class="mute">Deadlines come from your Moodle calendar. Items you have already submitted drop off automatically.</p></div>`);
}

// ---- courses ---------------------------------------------------------------------------------

async function coursesPage(t) {
  setHeader("Courses");
  await getGrades(forceFresh);
  forceFresh = false;
  if (stale(t)) return;
  paint(t, `<div class="course-grid">${S.courses.map((c) => {
    const g = S.grades[c.id];
    const prog = typeof c.progress === "number" ? Math.round(c.progress) : null;
    return `<a class="card course-card" href="#/courses/${c.id}" style="--c:${courseColor(c.id)}">
      <div class="cc-band"><div class="cc-code">${esc(shortName(c))}</div><div class="cc-term">${esc(courseTerm(c))}</div></div>
      <div class="cc-body"><h3>${esc(courseTitle(c))}</h3>
        ${prog !== null ? `<div><div class="bar"><span style="--w:${prog}%"></span></div><div class="mute" style="font-size:12px;margin-top:4px">${prog}% complete</div></div>` : ""}
        <div class="cc-foot"><span>Grade</span><b>${g && g !== "-" ? esc(g) : "Not graded yet"}</b></div></div></a>`;
  }).join("") || `<div class="card">${emptyState("book", "No courses", "You are not enrolled in any courses.")}</div>`}</div>`);
}

const TABS = [["content", "Content", "folder"], ["assignments", "Assignments", "clipboard"], ["forums", "Forums", "message"], ["grades", "Grades", "chart"]];

async function coursePage(t, id, tab) {
  const c = courseById(id) || {id: Number(id), fullname: "Course " + id};
  setHeader(courseTitle(c), [["Courses", "#/courses"], [shortName(c)]]);
  const fresh = forceFresh;
  forceFresh = false;
  const watchContent = S.status.settings.alerts.content;
  paint(t, `<div style="--c:${courseColor(c.id)}">
    <section class="banner"><div><div class="cc-code">${esc(shortName(c))}${courseTerm(c) ? " &middot; " + esc(courseTerm(c)) : ""}</div>
      <h2>${esc(courseTitle(c))}</h2></div>
      <a class="btn ghost" href="${BASE}/course/view.php?id=${c.id}" target="_blank" rel="noopener">${icon("external")} Open in Moodle</a></section>
    <nav class="tabs" aria-label="Course sections">${TABS.map(([k, label, ic]) => `<a href="#/courses/${c.id}/${k}" ${k === tab ? 'aria-current="page"' : ""}>${icon(ic)}${label}</a>`).join("")}</nav>
    <div id="recentbox"></div><div id="tabbody">${sk(60)}<div style="height:12px"></div>${sk(240)}</div></div>`);
  if (watchContent) {
    api("/recent?course=" + c.id).then((r) => {
      if (stale(t)) return;
      recentSig = sigOf(r);
      const box = $("#recentbox");
      if (box) box.innerHTML = r.recent.length ? recentCard(r, false) + '<div style="height:16px"></div>' : "";
    }).catch(() => {});
  } else {
    recentSig = null;
  }
  const body = () => (stale(t) ? null : $("#tabbody"));
  if (tab === "content") return courseContent(t, c, fresh, body);
  if (tab === "assignments") return courseAssignments(t, c, body);
  if (tab === "forums") return courseForums(t, c, body);
  return courseGrades(t, c, body);
}

function modRow(m) {
  const files = (m.contents || []).filter((f) => f.type === "file");
  const [label] = MOD[m.modname] || [m.modplural || m.modname, "file"];
  const single = m.modname !== "folder" && files.length > 0 ? files[0] : null;
  const tile = single ? extTile(single.filename) : `<span class="ext ${m.modname === "url" ? "link" : "act"}">${icon((MOD[m.modname] || [0, "file"])[1])}</span>`;
  const meta = single ? `${(fileExt(single.filename) || "file").toUpperCase()} · ${fmtSize(single.filesize)}${files.length > 1 ? ` · ${files.length} files` : ""}`
    : m.modname === "folder" ? `Folder · ${plural(files.length, "file")}` : label;
  const href = single ? single.fileurl : m.url;
  const text = (m.name + " " + files.map((f) => f.filename).join(" ")).toLowerCase();
  return `<div class="mod" data-text="${esc(text)}">${tile}
    <span class="grow">${href ? `<a class="t" href="${esc(href)}" target="_blank" rel="noopener">${esc(m.name)}</a>` : `<span class="t">${esc(m.name)}</span>`}<span class="sub">${esc(meta)}</span></span>
    <span class="acts">${single ? `<a class="icon-btn sm" href="${esc(single.fileurl)}" download title="Download" aria-label="Download ${esc(m.name)}">${icon("download")}</a>` : ""}
      ${m.url ? `<a class="icon-btn sm ext-open" href="${esc(m.url)}" target="_blank" rel="noopener" title="Open in Moodle" aria-label="Open ${esc(m.name)} in Moodle">${icon("external")}</a>` : ""}</span></div>`;
}

async function courseContent(t, c, fresh, body) {
  const sections = await api("/course/" + c.id + (fresh ? "?fresh=1" : ""));
  const secs = sections.map((s) => ({...s, modules: (s.modules || []).filter((m) => m.modname !== "label" && m.modname !== "subsection" && m.uservisible !== false)}))
    .filter((s) => s.modules.length);
  const total = secs.reduce((n, s) => n + s.modules.length, 0);
  const el = body();
  if (!el) return;
  if (!secs.length) { el.innerHTML = `<div class="card">${emptyState("folder", "Nothing here yet", "This course has no visible content.")}</div>`; return; }
  el.innerHTML = `<div class="toolbar"><div class="input-wrap">${icon("search")}<input class="input" id="filter" type="search" placeholder="Filter ${total} files and activities" aria-label="Filter course content"></div>
    <button class="btn" data-action="toggle-all">Collapse all</button></div>
    <div id="secs">${secs.map((s) => `<details class="section" open><summary>${icon("chev", "chev")}<span class="grow">${esc(s.name)}</span><span class="chip" data-n>${plural(s.modules.length, "item")}</span></summary>
      ${s.modules.map(modRow).join("")}</details>`).join("")}</div>
    <div id="nomatch" hidden>${emptyState("search", "No matches", "Try a different word.")}</div>`;
}

function filterContent(q) {
  q = q.trim().toLowerCase();
  let any = false;
  for (const d of $$("#secs details")) {
    const mods = $$(".mod", d);
    let n = 0;
    for (const m of mods) {
      const show = !q || m.dataset.text.includes(q);
      m.hidden = !show;
      if (show) n++;
    }
    d.hidden = n === 0;
    if (q && n) d.open = true;
    $("[data-n]", d).textContent = q ? `${n} of ${mods.length}` : plural(mods.length, "item");
    any = any || n > 0;
  }
  $("#nomatch").hidden = any;
}

async function courseAssignments(t, c, body) {
  const r = await api("/assignments/" + c.id);
  const list = ((r.courses && r.courses[0] && r.courses[0].assignments) || []).slice().sort((a, b) => (a.duedate || 9e12) - (b.duedate || 9e12));
  const el = body();
  if (!el) return;
  const n = nowS();
  el.innerHTML = list.length ? `<section class="card flush"><div class="list">${list.map((a) => {
    const left = a.duedate - n;
    const cls = !a.duedate ? "" : left < 0 ? "" : left < 86400 ? "warn" : left < 3 * 86400 ? "accent" : "";
    return `<a class="item" href="${BASE}/mod/assign/view.php?id=${a.cmid}" target="_blank" rel="noopener"><span class="ico-c">${icon("clipboard")}</span>
      <span class="grow"><span class="t">${esc(a.name)}</span><span class="sub">${a.duedate ? "Due " + esc(fmtWhen(a.duedate)) : "No due date"}</span></span>
      ${a.duedate ? `<span class="chip ${cls}">${left < 0 ? "Closed " + esc(relTime(a.duedate)) : esc(relTime(a.duedate))}</span>` : ""}</a>`;
  }).join("")}</div></section>` : `<div class="card">${emptyState("clipboard", "No assignments", "This course has no assignments yet.")}</div>`;
}

async function courseForums(t, c, body) {
  const forums = await api("/forums/" + c.id);
  const el = body();
  if (!el) return;
  el.innerHTML = forums.length ? forums.map((f) => `<details class="section" data-forum="${f.id}"><summary>${icon("chev", "chev")}<span class="ico-c">${icon("message")}</span>
      <span class="grow">${esc(f.name)}</span><span class="chip">${plural(f.numdiscussions || 0, "discussion")}</span></summary><div class="forum-body"></div></details>`).join("")
    : `<div class="card">${emptyState("message", "No forums", "This course has no forums.")}</div>`;
}

async function loadForum(d) {
  const box = $(".forum-body", d);
  if (box.dataset.loaded) return;
  box.dataset.loaded = 1;
  box.innerHTML = `<div style="padding:0 18px 14px">${sk(44)}</div>`;
  try {
    const r = await api("/discussions/" + d.dataset.forum);
    const list = r.discussions || [];
    box.innerHTML = list.map((x) => `<details class="disc" data-discussion="${x.discussion}"><summary>${icon("chev", "chev")}
      <span class="grow"><span class="t" style="display:block">${esc(x.name)}</span><span class="mute" style="font-size:13px;font-weight:500">${esc(x.userfullname)} &middot; ${esc(relTime(x.created))}</span></span>
      ${x.numreplies ? `<span class="chip">${plural(x.numreplies, "reply").replace("replys", "replies")}</span>` : ""}</summary><div class="posts"></div></details>`).join("")
      || `<div style="padding:0 18px 16px" class="mute">No discussions yet.</div>`;
  } catch (e) {
    box.dataset.loaded = "";
    box.innerHTML = `<div class="notice danger" style="margin:0 18px 14px">${esc(e.message)}</div>`;
  }
}

async function loadPosts(d) {
  const box = $(".posts", d);
  if (box.dataset.loaded) return;
  box.dataset.loaded = 1;
  box.innerHTML = sk(60);
  try {
    const r = await api("/posts/" + d.dataset.discussion);
    const posts = (r.posts || []).slice().sort((a, b) => a.timecreated - b.timecreated);
    box.replaceChildren(...posts.map((p) => {
      const w = document.createElement("div");
      w.className = "post";
      w.innerHTML = `<div class="post-h"><b>${esc(p.author && p.author.fullname)}</b> &middot; ${esc(fmtWhen(p.timecreated))}</div>`;
      w.append(htmlBox(p.message));
      if ((p.attachments || []).length) {
        const a = document.createElement("div");
        a.innerHTML = p.attachments.map((x) => `<a class="attach" href="${esc(x.fileurl)}" target="_blank" rel="noopener">${icon("paperclip")}${esc(x.filename)}</a>`).join("");
        w.append(a);
      }
      return w;
    }));
  } catch (e) {
    box.dataset.loaded = "";
    box.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`;
  }
}

async function courseGrades(t, c, body) {
  const r = await api("/grades/" + c.id);
  const items = (r.usergrades && r.usergrades[0] && r.usergrades[0].gradeitems) || [];
  const el = body();
  if (!el) return;
  if (!items.length) { el.innerHTML = `<div class="card">${emptyState("chart", "No grades yet")}</div>`; return; }
  el.innerHTML = `<section class="card"><div class="table-wrap"><table>
    <thead><tr><th>Item</th><th>Grade</th><th>Range</th><th>Percentage</th><th>Feedback</th></tr></thead><tbody>
    ${items.map((i) => {
      const pct = parseFloat(i.percentageformatted);
      const isTotal = i.itemtype === "course";
      return `<tr class="${isTotal ? "total" : ""}"><td>${esc(i.itemname || (isTotal ? "Course total" : "Category total"))}</td>
        <td><b>${esc(i.gradeformatted || "-")}</b></td><td class="mute">${esc(i.rangeformatted || "")}</td>
        <td>${isNaN(pct) ? '<span class="mute">-</span>' : `<div class="pct"><div class="bar"><span style="--w:${Math.max(0, Math.min(100, pct))}%"></span></div><span>${esc(i.percentageformatted)}</span></div>`}</td>
        <td class="fb">${esc(strip(i.feedback))}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
}

// ---- grades overview -------------------------------------------------------------------------

async function gradesPage(t) {
  setHeader("Grades");
  paint(t, sk(300));
  await getGrades(forceFresh);
  forceFresh = false;
  if (stale(t)) return;
  paint(t, `<section class="card flush"><div class="list">${S.courses.map((c) => {
    const g = S.grades[c.id];
    return `<a class="item" href="#/courses/${c.id}/grades">${codeBadge(c, "lg")}
      <span class="grow"><span class="t">${esc(courseTitle(c))}</span><span class="sub">${esc(courseTerm(c))}</span></span>
      <span class="chip ${g && g !== "-" ? "accent" : ""}">${g && g !== "-" ? esc(g) : "Not graded yet"}</span>${icon("chev")}</a>`;
  }).join("")}</div></section><p class="mute">Course totals as shown in Moodle. Open a course for item-by-item grades and feedback.</p>`);
}

// ---- messages --------------------------------------------------------------------------------

async function messagesPage(t, convId) {
  setHeader("Messages");
  paint(t, sk(420));
  const r = await api("/conversations");
  if (stale(t)) return;
  const me = S.status.user.userid;
  const convs = r.conversations || [];
  const nameOf = (c) => c.name || (c.members || []).filter((m) => m.id !== me).map((m) => m.fullname).join(", ") || "Conversation";
  paint(t, `<section class="card msgs ${convId ? "has-thread" : ""}">
    <div class="conv-list">${convs.map((c) => {
      const last = (c.messages || [])[0];
      return `<a class="conv" href="#/messages/${c.id}" ${String(c.id) === convId ? 'aria-current="page"' : ""}>
        <span class="avatar">${esc(initials(nameOf(c)))}</span>
        <span class="grow"><span class="t">${esc(nameOf(c))}</span><span class="sub">${esc(strip(last && last.text).slice(0, 80))}</span></span>
        ${c.unreadcount ? `<span class="count">${c.unreadcount}</span>` : ""}</a>`;
    }).join("") || emptyState("message", "No conversations")}</div>
    <div class="thread" id="thread">${convId ? `<div class="bubbles">${sk(40, "width:60%")}${sk(40, "width:45%;align-self:flex-end")}</div>` : emptyState("message", "Pick a conversation", "Your Moodle messages appear here.")}</div>
  </section>`);
  if (!convId) return;
  const conv = convs.find((c) => String(c.id) === convId);
  const th = await api("/conversation/" + convId);
  if (stale(t)) return;
  const msgs = (th.messages || []).slice().sort((a, b) => a.timecreated - b.timecreated);
  let lastDay = "";
  const bubbles = msgs.map((m) => {
    const day = new Date(m.timecreated * 1000).toDateString();
    const sep = day !== lastDay ? `<div class="day-sep">${esc(new Date(m.timecreated * 1000).toLocaleDateString([], {weekday: "short", day: "numeric", month: "short"}))}</div>` : "";
    lastDay = day;
    return `${sep}<div class="bubble ${m.useridfrom === me ? "mine" : ""}">${esc(strip(m.text))}<small>${esc(fmtTime(m.timecreated))}</small></div>`;
  }).join("");
  $("#thread").innerHTML = `<div class="thread-h"><a class="icon-btn sm back-btn" href="#/messages" aria-label="Back to conversations">${icon("back")}</a>
      <span class="avatar">${esc(initials(conv ? nameOf(conv) : ""))}</span><span class="grow">${esc(conv ? nameOf(conv) : "Conversation")}</span>
      <a class="btn sm" href="${BASE}/message/index.php?id=${conv ? ((conv.members || []).find((m) => m.id !== me) || {}).id || "" : ""}" target="_blank" rel="noopener">${icon("external")} Reply in Moodle</a></div>
    <div class="bubbles" id="bubbles">${bubbles || emptyState("message", "No messages yet")}</div>`;
  const b = $("#bubbles");
  b.scrollTop = b.scrollHeight;
}

// ---- notifications ---------------------------------------------------------------------------

async function notificationsPage(t) {
  setHeader("Notifications");
  paint(t, sk(360));
  const r = await api("/notifications");
  if (stale(t)) return;
  const list = r.notifications || [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = today.getTime() / 1000;
  const groups = [["Today", []], ["Yesterday", []], ["Earlier this week", []], ["Older", []]];
  for (const n of list) {
    const d = start - n.timecreated;
    groups[d <= 0 ? 0 : d <= 86400 ? 1 : d <= 6 * 86400 ? 2 : 3][1].push(n);
  }
  const unread = r.unreadcount || 0;
  paint(t, `<div class="stack">
    <div class="toolbar"><span class="grow mute">${unread ? `${plural(unread, "unread notification")}` : "You're all caught up."}</span>
      ${unread ? `<button class="btn" data-action="markread">${icon("check")} Mark all as read</button>` : ""}</div>
    ${groups.filter(([, l]) => l.length).map(([name, l]) => `<section class="card flush"><div class="card-h"><h3>${name}</h3></div>
      <div class="list">${l.map(notifItem).join("")}</div></section>`).join("") || `<div class="card">${emptyState("bell", "No notifications")}</div>`}</div>`);
}

// ---- settings --------------------------------------------------------------------------------

async function settingsPage(t) {
  setHeader("Settings");
  paint(t, sk(420));
  S.status = await api("/status");
  if (stale(t)) return;
  const s = S.status.settings, w = S.status.watcher, u = S.status.user || {};
  const all = s.watch_courses === null;
  const watched = new Set(s.watch_courses || []);
  const sw = (name, on, label, desc, disabled = false) => `<div class="setting"><div><div class="lbl">${label}</div>${desc ? `<div class="desc">${desc}</div>` : ""}</div>
    <div class="ctl"><input type="checkbox" class="switch" name="${name}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""} role="switch" aria-label="${esc(label)}"></div></div>`;
  const sel = (name, vals, cur) => `<select class="input" name="${name}">${vals.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>Every ${v === 60 ? "hour" : plural(v, "minute")}</option>`).join("")}</select>`;
  const ok = !w.last_error;
  paint(t, `<form class="stack settings" id="settings" autocomplete="off">
    <section class="card"><div class="card-h"><h3>${icon("lock")} Account</h3></div>
      <div class="setting"><div style="display:flex;gap:12px;align-items:center"><span class="avatar">${esc(initials(u.fullname))}</span>
        <div><div class="lbl">${esc(u.fullname || "")}</div><div class="desc">Signed in to activity.act.edu</div></div></div>
        <div class="ctl"><button type="button" class="btn" data-action="logout">${icon("logout")} Sign out</button></div></div>
      <div class="setting"><div class="status-line"><span class="status-dot ${ok ? "" : "bad"}"></span>
        <span>${ok ? "Background checks are working." : "Last check failed: " + esc(w.last_error)}
        <span class="mute">${w.last_run ? "Last check " + esc(relTime(w.last_run)) : "Not checked yet"}${w.next_run ? ", next " + esc(relTime(w.next_run)) : ""}.</span></span></div>
        <div class="ctl"><button type="button" class="btn" data-action="check">${icon("refresh")} Check now</button></div></div>
    </section>

    <section class="card"><div class="card-h"><h3>${icon("bell")} Alerts</h3><button type="button" class="btn sm" data-action="test">Send a test alert</button></div>
      ${sw("deadlines", s.alerts.deadlines, "Deadlines and reminders", "New deadlines in your courses, plus a reminder before each one is due.")}
      <div class="setting"><div><div class="lbl">Remind me before a deadline</div><div class="desc">Hours before the due time, separated by commas. For example: 24, 1</div></div>
        <div class="ctl"><input class="input" name="reminders" value="${esc(s.reminder_hours.join(", "))}" inputmode="decimal" aria-label="Reminder hours"></div></div>
      ${sw("grades", s.alerts.grades, "New grades", "An alert when a grade is posted or changed.")}
      ${sw("gradeval", s.grades_show_value, "Show the grade in the alert", "Off keeps the number private from anyone who can see your screen.")}
      ${sw("content", s.alerts.content, "Course changes", "New or newly visible files, resources and forum posts. Off by default because it makes more requests to the school's server.")}
    </section>

    <section class="card"><div class="card-h"><h3>${icon("book")} Courses to watch</h3></div>
      <div class="seg" role="radiogroup" aria-label="Courses to watch">
        <label><input type="radio" name="scope" value="all" ${all ? "checked" : ""}>All my courses</label>
        <label><input type="radio" name="scope" value="some" ${all ? "" : "checked"}>Only selected</label></div>
      <div class="course-pick ${all ? "disabled" : ""}" id="coursepick">${S.courses.map((c) => `<label><input type="checkbox" name="course" value="${c.id}" ${all || watched.has(c.id) ? "checked" : ""}>
        ${codeBadge(c)}<span class="grow">${esc(courseTitle(c))}</span></label>`).join("")}</div>
    </section>

    <section class="card"><div class="card-h"><h3>${icon("clock")} How often to check</h3></div>
      <div class="setting"><div><div class="lbl">Deadlines${s.alerts.content ? " and course changes" : ""}</div><div class="desc">Each check makes a few requests per course. Every 5 minutes is plenty for most people.</div></div>
        <div class="ctl">${sel("interval", [1, 2, 5, 10, 15, 30], s.interval_minutes)}</div></div>
      <div class="setting"><div><div class="lbl">Grades</div><div class="desc">Grades change rarely, so this can be slower.</div></div>
        <div class="ctl">${sel("ginterval", [5, 15, 30, 60], s.grades_interval_minutes)}</div></div>
    </section>

    <section class="card"><div class="card-h"><h3>${icon("power")} Background</h3></div>
      ${S.status.autostart.supported ? sw("autostart", S.status.autostart.enabled, "Start when I log in to this computer", "Alerts only arrive while ACT Companion is running. Closing the browser tab does not stop it.")
        : '<p class="mute">Starting at login is not supported on this system.</p>'}
      <div class="setting"><div><div class="lbl">Quit ACT Companion</div><div class="desc">Stops background checks until you open it again. Version ${esc(S.status.version)}.</div></div>
        <div class="ctl"><button type="button" class="btn danger" data-action="quit">${icon("power")} Quit</button></div></div>
    </section>
  </form>`);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 350);
}
async function saveSettings() {
  const f = $("#settings");
  if (!f) return;
  const some = f.scope.value === "some";
  $("#coursepick").classList.toggle("disabled", !some);
  const ids = $$("input[name=course]:checked", f).map((x) => Number(x.value));
  if (some && !ids.length) return toast("Pick at least one course, or choose All my courses.", true);
  const hours = f.reminders.value.split(",").map((x) => parseFloat(x)).filter((x) => x > 0);
  try {
    const saved = await api("/settings", {
      watch_courses: some ? ids : null,
      alerts: {content: f.content.checked, deadlines: f.deadlines.checked, grades: f.grades.checked},
      reminder_hours: hours, grades_show_value: f.gradeval.checked,
      interval_minutes: Number(f.interval.value), grades_interval_minutes: Number(f.ginterval.value),
    });
    S.status.settings = saved;
    f.reminders.value = saved.reminder_hours.join(", ");
    toast("Settings saved");
  } catch (e) {
    toast(e.message, true);
  }
}

// ---- command palette -------------------------------------------------------------------------

const P = {items: [], shown: [], sel: 0, files: null, filesAt: 0, loading: false};

function paletteBase() {
  const out = NAV.map((n) => ({group: "Pages", label: n.label, href: n.href, tile: `<span class="ico-c">${icon(n.icon)}</span>`}));
  for (const c of S.courses) out.push({group: "Courses", label: `${shortName(c)}: ${courseTitle(c)}`, sub: courseTerm(c), href: `#/courses/${c.id}`,
    tile: `<span class="ext" style="--x:${courseColor(c.id)}">${icon("book")}</span>`});
  for (const e of S.deadlines || []) {
    if (e.timesort < nowS() && !isOpenDeadline(e)) continue;
    out.push({group: "Deadlines", label: e.activityname || e.name, sub: `${shortName(e.course)} · ${relTime(e.timesort)}`,
      href: (e.action && e.action.url) || e.url, external: true, tile: `<span class="ico-c">${icon("calendar")}</span>`});
  }
  return out;
}

async function loadFileIndex() {
  if (P.loading || (P.files && Date.now() - P.filesAt < 10 * 60000)) return;
  P.loading = true;
  try {
    const lists = await Promise.all(S.courses.map((c) => api("/course/" + c.id).then((secs) => [c, secs]).catch(() => [c, []])));
    const files = [];
    for (const [c, secs] of lists) {
      for (const s of secs) for (const m of s.modules || []) {
        if (m.modname === "label" || m.modname === "subsection") continue;
        const fl = (m.contents || []).filter((f) => f.type === "file");
        const single = m.modname !== "folder" && fl[0];
        files.push({group: "Files and activities", label: m.name, sub: `${shortName(c)} · ${s.name}${single ? " · " + single.filename : ""}`,
          href: single ? single.fileurl : m.url, external: true,
          tile: single ? extTile(single.filename) : `<span class="ext act">${icon((MOD[m.modname] || [0, "file"])[1])}</span>`});
      }
    }
    P.files = files;
    P.filesAt = Date.now();
  } finally {
    P.loading = false;
  }
  if ($("#palette").classList.contains("open")) renderPalette();
}

function openPalette() {
  const pal = $("#palette");
  if (!pal) return;
  pal.classList.add("open");
  $("#pq").value = "";
  if (!S.deadlines) getDeadlines().then(() => renderPalette()).catch(() => {});
  renderPalette();
  $("#pq").focus();
  loadFileIndex();
}
function closePalette() { const pal = $("#palette"); if (pal) pal.classList.remove("open"); }

function renderPalette() {
  const q = $("#pq").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  let pool = paletteBase();
  if (q) pool = pool.concat(P.files || []);
  const match = (it) => { const hay = (it.label + " " + (it.sub || "")).toLowerCase(); return words.every((w) => hay.includes(w)); };
  const shown = (q ? pool.filter(match) : pool.filter((it) => it.group !== "Deadlines" || pool.indexOf(it) < NAV.length + S.courses.length + 5)).slice(0, 60);
  P.shown = shown;
  P.sel = Math.min(P.sel, Math.max(0, shown.length - 1));
  if (!q) P.sel = 0;
  let group = "";
  const html = shown.map((it, i) => {
    const head = it.group !== group ? `<div class="res-group">${esc(it.group)}</div>` : "";
    group = it.group;
    return `${head}<div class="res" role="option" id="res${i}" data-i="${i}" aria-selected="${i === P.sel}">${it.tile}
      <span class="grow"><span class="t">${esc(it.label)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ""}</span>${it.external ? icon("external") : ""}</div>`;
  }).join("");
  const loading = q && P.loading ? '<div class="res-group">Loading course files...</div>' : "";
  $("#presults").innerHTML = html + loading || `<div class="empty"><b>No results</b>Try a course code, file name or deadline.</div>`;
}

function movePalette(delta) {
  if (!P.shown.length) return;
  P.sel = (P.sel + delta + P.shown.length) % P.shown.length;
  for (const el of $$(".res")) el.setAttribute("aria-selected", String(Number(el.dataset.i) === P.sel));
  const cur = $("#res" + P.sel);
  if (cur) cur.scrollIntoView({block: "nearest"});
}

function activatePalette(i) {
  const it = P.shown[i];
  if (!it || !it.href) return;
  closePalette();
  if (it.href.startsWith("#")) location.hash = it.href;
  else window.open(it.href, "_blank", "noopener");
}

// ---- events ----------------------------------------------------------------------------------

const ACTIONS = {
  theme: toggleTheme,
  opennav: () => $("#shell").classList.add("nav-open"),
  closenav: () => $("#shell").classList.remove("nav-open"),
  palette: openPalette,
  reload: () => location.reload(),
  retry: () => route(),
  refresh: async () => {
    try { await api("/refresh", {}); } catch (e) { /* still re-render below */ }
    forceFresh = true;
    P.files = null;
    S.gradesAt = 0;
    S.deadlinesAt = 0;
    refreshUnread();
    await route();
    toast("Refreshed");
  },
  "toggle-all": (el) => {
    const ds = $$("#secs details");
    const open = ds.some((d) => d.open);
    ds.forEach((d) => { d.open = !open; });
    el.textContent = open ? "Expand all" : "Collapse all";
  },
  markread: async () => {
    await api("/notifications/read", {});
    S.unread.notifications = 0;
    renderNavCounts();
    toast("All notifications marked as read");
    route();
  },
  check: async () => { await api("/check-now", {}); toast("Checking now. This takes a few seconds."); setTimeout(() => { if (location.hash === "#/settings") route(); }, 6000); },
  test: async () => { const r = await api("/test-notification", {}); toast(r.ok ? "Test alert sent. Nothing showed up? Check your system's notification settings." : "Could not show an alert on this system.", !r.ok); },
  logout: async () => {
    if (!confirm("Sign out? Alerts stop until you sign in again, and this app's history for your account is deleted.")) return;
    await api("/logout", {});
    loginPage(false);
  },
  quit: async () => {
    if (!confirm("Quit ACT Companion? Alerts stop until you open it again.")) return;
    await api("/quit", {});
    S.status = null;
    $("#app").innerHTML = `<div class="auth"><div class="card auth-card">${emptyState("power", "ACT Companion has stopped", "You can close this tab.")}</div></div>`;
  },
};

document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-action]");
  if (a) {
    if (a.dataset.action === "closepalette-bg") { if (ev.target === a) closePalette(); return; }
    ev.preventDefault();
    const fn = ACTIONS[a.dataset.action];
    if (fn) Promise.resolve(fn(a)).catch((e) => toast(e.message, true));
    return;
  }
  const res = ev.target.closest(".res");
  if (res) activatePalette(Number(res.dataset.i));
});

// <details> "toggle" does not bubble, so listen in the capture phase to lazy-load forums and posts.
document.addEventListener("toggle", (ev) => {
  const d = ev.target;
  if (!(d instanceof HTMLDetailsElement) || !d.open) return;
  if (d.dataset.forum) loadForum(d);
  if (d.dataset.discussion) loadPosts(d);
}, true);

document.addEventListener("input", (ev) => {
  if (ev.target.id === "filter") filterContent(ev.target.value);
  if (ev.target.id === "pq") { P.sel = 0; renderPalette(); }
});

document.addEventListener("change", async (ev) => {
  const f = ev.target.form;
  if (!f || f.id !== "settings") return;
  if (ev.target.name === "autostart") {
    try {
      const r = await api("/autostart", {enabled: ev.target.checked});
      ev.target.checked = r.enabled;
      toast(r.enabled ? "ACT Companion will start when you log in" : "Start at login turned off");
    } catch (e) { toast(e.message, true); }
    return;
  }
  scheduleSave();
});

document.addEventListener("mousemove", (ev) => {
  const res = ev.target.closest && ev.target.closest(".res");
  if (res && Number(res.dataset.i) !== P.sel) { P.sel = Number(res.dataset.i); movePalette(0); }
});

document.addEventListener("keydown", (ev) => {
  const pal = $("#palette");
  const open = pal && pal.classList.contains("open");
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); open ? closePalette() : openPalette(); return; }
  if (open) {
    if (ev.key === "Escape") { ev.preventDefault(); closePalette(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); movePalette(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); movePalette(-1); }
    else if (ev.key === "Enter") { ev.preventDefault(); activatePalette(P.sel); }
    return;
  }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement && document.activeElement.tagName);
  if (ev.key === "/" && !typing && pal) { ev.preventDefault(); openPalette(); }
  if (ev.key === "Escape") { const sh = $("#shell"); if (sh) sh.classList.remove("nav-open"); }
});

window.addEventListener("hashchange", route);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderThemeBtn);

// Background refreshes: unread counts every 2 minutes; course-change items every 20 seconds when that alert is on.
setInterval(() => { if (S.status) refreshUnread(); }, 120000);
setInterval(async () => {
  if (!S.status || !S.status.settings.alerts.content || recentSig === null) return;
  const m = location.hash.match(/^#\/courses\/(\d+)/);
  const onHome = !location.hash || location.hash === "#/";
  if (!m && !onHome) return;
  try {
    const r = await api("/recent" + (m ? "?course=" + m[1] : ""));
    if (sigOf(r) !== recentSig) { toast("New items in your courses"); forceFresh = true; route(); }
  } catch (e) { /* app restarting, try again next tick */ }
}, 20000);

boot();
