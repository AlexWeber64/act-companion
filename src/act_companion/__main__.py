"""Command line entry point.

  act-companion                    open the app window (or bring the running one to the front)
  act-companion --background       start in the system tray without a window (used by "start at login")
  act-companion --browser          use your web browser instead of the app window
  act-companion --check            run one round of checks in the foreground and exit
  act-companion --test-notification
"""
import argparse
import socket
import sys
import time
import webbrowser

import requests

from . import __version__, autostart, config, notify, server


def main(argv=None):
    ap = argparse.ArgumentParser(prog="act-companion", description="Unofficial client for activity.act.edu")
    ap.add_argument("--background", action="store_true", help="start without opening a window")
    ap.add_argument("--browser", action="store_true", help="show the dashboard in your web browser instead of the app window")
    ap.add_argument("--check", action="store_true", help="run one round of checks and exit")
    ap.add_argument("--test-notification", action="store_true")
    ap.add_argument("--version", action="version", version=__version__)
    a = ap.parse_args(argv)

    if a.test_notification:
        ok = notify.send("ACT Companion", "Test notification. If you can read this, alerts work.")
        print("sent" if ok else f"failed, see {config.LOG_FILE}")
        return 0 if ok else 1
    if a.check:
        w = server.WATCHER
        ok = w.run_once()
        print("ok" if ok else f"failed: {w.status['last_error']}")
        return 0 if ok else 1

    url = server.app_url()
    if server.ping():  # already running: bring up its window
        if a.background or show_running():
            return 0
        # The running copy has no window: an older version (0.1 only used the browser) or one started with
        # --browser. Asked for the app window, replace it; otherwise open the browser as before.
        if a.browser or not take_over():
            webbrowser.open(url)
            return 0
    if getattr(sys, "frozen", False):  # only the copy that actually runs may claim start at login
        try:
            autostart.refresh()
        except OSError as e:
            config.log(f"could not update start at login: {e}")
    if not a.browser:
        from . import desktop
        if desktop.available():
            if desktop.run(background=a.background):
                return 0
            print(f"Port {config.PORT} is in use by another program.", file=sys.stderr)
            return 1
        config.log("app window unavailable (pywebview missing), using the browser")
    on_ready = None if a.background else (lambda: webbrowser.open(url))
    if not a.background:
        print(f"ACT Companion running at http://{config.HOST}:{config.PORT}  (Ctrl+C to stop)")
    if not server.serve(on_ready):
        print(f"Port {config.PORT} is in use by another program.", file=sys.stderr)
        return 1
    return 0


def ask_running(path):
    """POST to the running ACT Companion. True if it answered {"ok": true}."""
    try:
        r = requests.post(f"http://{config.HOST}:{config.PORT}{path}", json={}, timeout=5,
                          cookies={"ac_session": config.session_key()},
                          headers={"Origin": f"http://{config.HOST}:{config.PORT}"})
        return r.ok and r.json().get("ok") is True
    except (requests.RequestException, ValueError):
        return False


def show_running():
    """Ask an already-running ACT Companion to show its window. False if it has none (browser mode)."""
    return ask_running("/api/show")


def take_over(timeout=15):
    """Quit the running windowless ACT Companion so this one can start with a window. True once the port is free."""
    from . import desktop
    if not desktop.available() or not ask_running("/api/quit"):
        return False
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket() as s:
            try:
                s.bind((config.HOST, config.PORT))
                return True
            except OSError:
                time.sleep(0.25)
    return False


def background():
    """Entry point for the windowless launcher."""
    sys.exit(main(["--background"]))


if __name__ == "__main__":
    sys.exit(main())
