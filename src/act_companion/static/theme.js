// Applied before first paint so a saved theme does not flash. No value = follow the system (Nocturne dark, Daylight light).
try {
  var t = localStorage.getItem("theme");
  if (["nocturne", "graphite", "daylight", "paper"].indexOf(t) !== -1) document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable, follow the system */ }
