"""Command line entry point.

  act-companion                    open the app window (or bring the running one to the front)
  act-companion --background       start in the system tray without a window (used by "start at login")
  act-companion --browser          use your web browser instead of the app window
  act-companion --check            run one round of checks in the foreground and exit
  act-companion --test-notification
"""
import argparse
import sys
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
    if server.ping():  # already running: bring up its window, or the browser if it runs without one
        if not a.background and not show_running():
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


def show_running():
    """Ask an already-running ACT Companion to show its window. False if it has none (browser mode)."""
    try:
        r = requests.post(f"http://{config.HOST}:{config.PORT}/api/show", json={}, timeout=5,
                          cookies={"ac_session": config.session_key()},
                          headers={"Origin": f"http://{config.HOST}:{config.PORT}"})
        return r.ok and r.json().get("ok") is True
    except (requests.RequestException, ValueError):
        return False


def background():
    """Entry point for the windowless launcher."""
    sys.exit(main(["--background"]))


if __name__ == "__main__":
    sys.exit(main())
