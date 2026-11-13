#!/usr/bin/env bash
# Install ACT Companion on Linux for the current user: a private virtualenv, a launcher in ~/.local/bin,
# and an entry in the app menu. Run it from a clone of the repository:  packaging/install-linux.sh
# Uninstall with:  packaging/install-linux.sh --uninstall
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
venv="$data/act-companion-app"
bin="$HOME/.local/bin/act-companion"
desktop="$data/applications/act-companion.desktop"
icon="$data/icons/hicolor/256x256/apps/act-companion.png"
old_icon="$data/icons/hicolor/scalable/apps/act-companion.svg"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$venv" "$bin" "$desktop" "$icon" "$old_icon"
  if command -v kbuildsycoca6 >/dev/null; then kbuildsycoca6 >/dev/null 2>&1 || true; fi
  echo "Removed. Your settings and sign-in are kept in $data/ACTCompanion (delete it too if you want)."
  exit 0
fi

command -v python3 >/dev/null || { echo "Python 3.10 or newer is required." >&2; exit 1; }

# --system-site-packages lets the app window use the system GTK and WebKit (python3-gobject, webkit2gtk4.1 on
# Fedora; python3-gi and gir1.2-webkit2-4.1 on Debian/Ubuntu). Without them the app opens in your browser instead.
python3 -m venv --system-site-packages "$venv"
"$venv/bin/pip" install --quiet --upgrade "$root"

mkdir -p "$(dirname "$bin")" "$(dirname "$desktop")" "$(dirname "$icon")"
ln -sf "$venv/bin/act-companion" "$bin"
cp "$root/src/act_companion/static/icon.png" "$icon"
rm -f "$old_icon"
gtk-update-icon-cache -q -t "$data/icons/hicolor" 2>/dev/null || true
cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=ACT Companion
Comment=Deadlines, grades and course files for activity.act.edu
Exec=$venv/bin/act-companion
Icon=act-companion
Categories=Education;
Terminal=false
DESKTOP
update-desktop-database "$(dirname "$desktop")" 2>/dev/null || true
# KDE keeps its own app cache and may not show the new entry until it is rebuilt.
if command -v kbuildsycoca6 >/dev/null; then kbuildsycoca6 >/dev/null 2>&1 || true; fi

echo "Installed. Open ACT Companion from your app menu, or run: act-companion"
python3 -c "import gi" 2>/dev/null || echo "Note: python3-gobject is missing, so it will open in your browser (Fedora: sudo dnf install python3-gobject webkit2gtk4.1)."
