"""Command line entry point.

  act-companion                    start (if needed) and open the dashboard
  act-companion --background       start without opening a browser (used by "start at login")
  act-companion --check            run one round of checks in the foreground and exit
  act-companion --test-notification
"""
import argparse
import sys
import webbrowser

from . import __version__, config, notify, server


def main(argv=None):
    ap = argparse.ArgumentParser(prog="act-companion", description="Unofficial client for activity.act.edu")
    ap.add_argument("--background", action="store_true", help="run without opening the browser")
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
    if server.ping():  # already running: just bring up the dashboard
        if not a.background:
            webbrowser.open(url)
        return 0
    on_ready = None if a.background else (lambda: webbrowser.open(url))
    if not a.background:
        print(f"ACT Companion running at http://{config.HOST}:{config.PORT}  (Ctrl+C to stop)")
    if not server.serve(on_ready):
        print(f"Port {config.PORT} is in use by another program.", file=sys.stderr)
        return 1
    return 0


def background():
    """Entry point for the windowless launcher."""
    sys.exit(main(["--background"]))


if __name__ == "__main__":
    sys.exit(main())
