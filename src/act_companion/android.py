"""Glue for the Android app (android/ in the repository), which runs this package with Chaquopy.

The app shows the same web UI in a WebView. Regular checks are scheduled by Android's WorkManager instead of the
watcher thread, because Android pauses the threads of apps that are not on screen.
"""
import threading
import time

from java import jclass

from . import config, server

SHELL = "io.github.alexweber64.actcompanion.Shell"
MIN_INTERVAL = 15  # WorkManager runs periodic work at most every 15 minutes
_lock = threading.Lock()


def start():
    """Start the dashboard server once per process and return the URL the WebView loads."""
    with _lock:
        if server.HTTPD is None:
            if not server.start_background(watch=False):
                raise RuntimeError(f"Port {config.PORT} is in use by another app.")
            server.UI["quit"] = lambda: jclass(SHELL).quit()
            server.UI["settings_saved"] = lambda s: jclass(SHELL).schedule(interval_minutes(s))
    return server.app_url()


def session_key():
    return config.session_key()


def interval_minutes(settings=None):
    return max(MIN_INTERVAL, (settings or config.load_settings())["interval_minutes"])


def check():
    """One scheduled round of checks, run by the app's WorkManager job. False if it failed."""
    ok = server.WATCHER.run_once()
    server.WATCHER.status["next_run"] = time.time() + interval_minutes() * 60
    return ok is not False
