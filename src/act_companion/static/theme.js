// Applied before first paint so a saved light/dark choice does not flash. Falls back to the system setting.
try {
  const t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable, follow the system */ }
