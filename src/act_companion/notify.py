"""Desktop notifications on Windows, macOS and Linux without extra dependencies, and Android notifications in the app."""
import os
import shutil
import subprocess
import sys

from . import config

APP_NAME = "ACT Companion"
MAX_INDIVIDUAL = 4

# Toasts are sent under PowerShell's registered app id, which exists on every Windows install.
WIN_APP_ID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
WIN_TOAST_PS = r"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Security.SecurityElement]::Escape($env:TOAST_TITLE)
$b = [Security.SecurityElement]::Escape($env:TOAST_BODY)
$u = [Security.SecurityElement]::Escape($env:TOAST_URL)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast activationType='protocol' launch='$u'><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:TOAST_APPID).Show($toast)
"""


def _run(args, env=None):
    r = subprocess.run(
        args, env=env, capture_output=True, text=True, timeout=30,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if r.returncode != 0:
        config.log(f"notification failed ({args[0]}): {r.stderr.strip()[:300]}")
    return r.returncode == 0


def _windows(title, body, url):
    env = {**os.environ, "TOAST_TITLE": title, "TOAST_BODY": body, "TOAST_URL": url, "TOAST_APPID": WIN_APP_ID}
    return _run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WIN_TOAST_PS], env=env)


def _mac(title, body, url):
    tn = shutil.which("terminal-notifier")
    if tn:  # optional (brew install terminal-notifier), adds click-to-open
        return _run([tn, "-title", title, "-message", body, "-open", url, "-group", APP_NAME])
    # Text goes in as argv, never spliced into the AppleScript source.
    return _run(["osascript", "-e", "on run argv", "-e",
                 "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run",
                 title, body])


def _linux(title, body, url):
    ns = shutil.which("notify-send")
    if not ns:
        config.log("notify-send not found; install libnotify (e.g. sudo apt install libnotify-bin)")
        return False
    return _run([ns, f"--app-name={APP_NAME}", title, body])


def _android(title, body, url):
    from java import jclass  # Chaquopy's bridge to the app's Kotlin code (android/)
    return bool(jclass("io.github.alexweber64.actcompanion.Shell").notify(title, body, url))


def send(title, body, url=None):
    url = url or config.BASE
    if sys.platform == "android":
        return _android(title, body, url)
    try:
        if sys.platform == "win32":
            return _windows(title, body, url)
        if sys.platform == "darwin":
            return _mac(title, body, url)
        return _linux(title, body, url)
    except (OSError, subprocess.SubprocessError) as e:
        config.log(f"notification error: {e}")
        return False


def send_batch(items):
    """items: list of (title, body, url). Collapse a burst into one summary so nobody gets flooded."""
    if len(items) > MAX_INDIVIDUAL:
        preview = "; ".join(body for _, body, _ in items[:3])
        send(f"{APP_NAME}: {len(items)} updates", f"{preview}; and more", config.BASE)
        return
    for title, body, url in items:
        send(title, body, url)
