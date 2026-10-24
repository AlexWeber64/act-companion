"""Start the app in the background at login: Run key on Windows, LaunchAgent on macOS, XDG autostart on Linux."""
import plistlib
import subprocess
import sys
from pathlib import Path

NAME = "ACTCompanion"
MAC_LABEL = "com.actcompanion.agent"
MAC_PLIST = Path.home() / "Library" / "LaunchAgents" / f"{MAC_LABEL}.plist"
LINUX_DESKTOP = Path.home() / ".config" / "autostart" / "act-companion.desktop"
WIN_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def command():
    if getattr(sys, "frozen", False):  # the packaged .exe is its own launcher
        return [sys.executable, "--background"]
    exe = Path(sys.executable)
    if sys.platform == "win32":
        windowless = exe.with_name("pythonw.exe")
        if windowless.exists():
            exe = windowless
    return [str(exe), "-m", "act_companion", "--background"]


def supported():
    return sys.platform in ("win32", "darwin") or sys.platform.startswith("linux")


def is_enabled():
    if sys.platform == "win32":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WIN_RUN_KEY) as k:
                winreg.QueryValueEx(k, NAME)
                return True
        except OSError:
            return False
    if sys.platform == "darwin":
        return MAC_PLIST.exists()
    return LINUX_DESKTOP.exists()


def _desktop_quote(arg):
    return '"' + arg.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("`", "\\`") + '"'


def set_enabled(enabled):
    cmd = command()
    if sys.platform == "win32":
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WIN_RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if enabled:
                winreg.SetValueEx(k, NAME, 0, winreg.REG_SZ, subprocess.list2cmdline(cmd))
            else:
                try:
                    winreg.DeleteValue(k, NAME)
                except FileNotFoundError:
                    pass
    elif sys.platform == "darwin":
        if enabled:
            MAC_PLIST.parent.mkdir(parents=True, exist_ok=True)
            with MAC_PLIST.open("wb") as f:
                plistlib.dump({"Label": MAC_LABEL, "ProgramArguments": cmd, "RunAtLoad": True,
                               "ProcessType": "Background"}, f)
        else:
            MAC_PLIST.unlink(missing_ok=True)
    else:
        if enabled:
            LINUX_DESKTOP.parent.mkdir(parents=True, exist_ok=True)
            LINUX_DESKTOP.write_text(
                "[Desktop Entry]\nType=Application\nName=ACT Companion\n"
                f"Exec={' '.join(_desktop_quote(a) for a in cmd)}\n"
                "NoDisplay=true\nX-GNOME-Autostart-enabled=true\n", encoding="utf-8")
        else:
            LINUX_DESKTOP.unlink(missing_ok=True)
    return is_enabled()


def refresh():
    """If start at login is on but points at another copy (the .exe was moved or replaced), point it at this one."""
    if sys.platform != "win32" or not is_enabled():
        return
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WIN_RUN_KEY) as k:
        current = winreg.QueryValueEx(k, NAME)[0]
    if current != subprocess.list2cmdline(command()):
        set_enabled(True)
