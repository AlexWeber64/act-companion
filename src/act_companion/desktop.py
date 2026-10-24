"""The app window: the dashboard in a native window (pywebview) with a system tray icon (pystray).

The web UI is the same one the browser shows. On Windows it renders in Microsoft Edge WebView2, which ships with
Windows 10 and 11. Closing the window keeps ACT Companion running in the tray so alerts keep arriving.
"""
import os
import re
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import requests

from . import config, notify, server

BG = "#161826"  # Nocturne background, shown while the page loads
TRAY_HINT_FLAG = config.DATA / "tray_hint_shown"
DEBUG_PORT_ENV = "ACT_COMPANION_DEBUG_PORT"  # opens WebView2's DevTools port, for automated UI tests only

# Files that are safe to open straight away in their default app. Anything else (scripts, programs, unknown
# types) is saved and shown in its folder, because opening a .py, .bat or .exe from a course page would run it.
SAFE_TO_OPEN = {"pdf", "doc", "docx", "odt", "rtf", "txt", "md", "ppt", "pptx", "odp", "key", "xls", "xlsx", "ods", "csv",
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "mp3", "mp4", "m4a", "mov", "wav", "zip", "rar", "7z"}


def available():
    try:
        import webview  # noqa: F401
        return True
    except Exception:  # pywebview missing, or no usable GUI backend on this system
        return False


def downloads_dir():
    d = Path.home() / "Downloads" / "ACT Companion"
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "file"
    return name[:150]


def unique_path(folder, name):
    p = folder / name
    stem, suffix, n = p.stem, p.suffix, 1
    while p.exists():
        p = folder / f"{stem} ({n}){suffix}"
        n += 1
    return p


def open_path(path):
    if sys.platform == "win32":
        os.startfile(path)  # noqa: S606 - only called for SAFE_TO_OPEN types
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


def reveal(path):
    if sys.platform == "win32":
        subprocess.run(["explorer", "/select,", str(path)], check=False)
    elif sys.platform == "darwin":
        subprocess.run(["open", "-R", str(path)], check=False)
    else:
        subprocess.run(["xdg-open", str(path.parent)], check=False)


class Bridge:
    """Methods the page can call as window.pywebview.api.*"""

    def open_external(self, url):
        if urlparse(str(url)).scheme in ("http", "https"):
            webbrowser.open(url)
            return {"ok": True}
        return {"ok": False, "error": "not a web link"}

    def open_file(self, url, filename=""):
        """Download a course file through the local proxy into Downloads/ACT Companion, then open or reveal it."""
        url = str(url)
        if not url.startswith("/api/file?"):
            return {"ok": False, "error": "not a course file"}
        try:
            r = requests.get(f"http://{config.HOST}:{config.PORT}{url}", timeout=120,
                             cookies={"ac_session": config.session_key()})
        except requests.RequestException as e:
            return {"ok": False, "error": f"download failed ({e.__class__.__name__})"}
        if r.status_code != 200:
            return {"ok": False, "error": f"download failed (HTTP {r.status_code})"}
        if not filename:
            m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', r.headers.get("Content-Disposition", ""))
            filename = m.group(1) if m else "file"
        path = unique_path(downloads_dir(), safe_name(filename))
        path.write_bytes(r.content)
        ext = path.suffix.lower().lstrip(".")
        try:
            if ext in SAFE_TO_OPEN:
                open_path(path)
                return {"ok": True, "opened": True, "path": str(path), "name": path.name}
            reveal(path)
            return {"ok": True, "opened": False, "path": str(path), "name": path.name}
        except OSError as e:
            return {"ok": True, "opened": False, "path": str(path), "name": path.name, "error": str(e)}


class App:
    def __init__(self, background):
        self.background = background
        self.window = None
        self.tray = None
        self.quitting = False
        self.loaded = not background

    # -- window -------------------------------------------------------------------------------

    def show(self):
        if not self.window:
            return
        if not self.loaded:
            self.loaded = True
            self.window.load_url(server.app_url())
        self.window.show()
        self.window.restore()

    def on_closing(self):
        if self.quitting or not self.tray:
            return True
        # Keep running in the tray so alerts keep arriving; tell the user once where it went.
        threading.Thread(target=self.window.hide, daemon=True).start()
        if not TRAY_HINT_FLAG.exists():
            try:
                config.ensure_dir()
                TRAY_HINT_FLAG.write_text("1", encoding="utf-8")
            except OSError:
                pass
            notify.send("ACT Companion is still running", "Alerts keep coming. Open it again or quit from the tray icon.")
        return False

    def quit(self):
        self.quitting = True
        if self.tray:
            try:
                self.tray.stop()
            except Exception:
                pass
        if self.window:
            self.window.destroy()

    # -- tray ---------------------------------------------------------------------------------

    def start_tray(self):
        if sys.platform != "win32":  # macOS needs the tray on the main thread, which pywebview owns; Linux is untested
            return
        try:
            import pystray
            from PIL import Image, ImageDraw
        except Exception as e:
            config.log(f"no tray icon: {e}")
            return
        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=14, fill="#10111b")
        d.rounded_rectangle([22, 22, 42, 42], radius=4, fill="#9184d9")
        menu = pystray.Menu(
            pystray.MenuItem("Open ACT Companion", lambda: self.show(), default=True),
            pystray.MenuItem("Check now", lambda: server.WATCHER.wake.set()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", lambda: self.quit()),
        )
        self.tray = pystray.Icon("ACTCompanion", img, "ACT Companion", menu)
        threading.Thread(target=self.tray.run, daemon=True, name="tray").start()

    # -- run ----------------------------------------------------------------------------------

    def run(self):
        import webview

        if not server.start_background():
            return False
        server.UI["show"], server.UI["quit"] = self.show, self.quit
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        if os.environ.get(DEBUG_PORT_ENV):
            webview.settings["REMOTE_DEBUGGING_PORT"] = int(os.environ[DEBUG_PORT_ENV])
        self.window = webview.create_window(
            "ACT Companion",
            url=None if self.background else server.app_url(),
            html=None if not self.background else f'<body style="background:{BG}"></body>',
            width=1280, height=840, min_size=(380, 560), hidden=self.background,
            background_color=BG, js_api=Bridge(), text_select=True)
        self.window.events.closing += self.on_closing
        self.start_tray()
        try:
            webview.start(private_mode=False, storage_path=str(config.DATA / "webview"))
        finally:
            server.shutdown()
        return True


def run(background=False):
    """Run the app window until the user quits. Returns False if another program holds the port."""
    return App(background).run()
