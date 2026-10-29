"""Build the web app (iPhone home screen, or any browser) into a folder of static files.

  python web/build.py [out_dir]          default: build/web
  python web/build.py --app out_dir      for the Android app's assets (android/app/build.gradle.kts)

It is the desktop UI (src/act_companion/static) plus web.js, which talks to activity.act.edu directly, a web app
manifest, home screen icons and a service worker. The CI workflow publishes the result on GitHub Pages. The Android app
bundles the same files without the manifest, icons and service worker (and needs no Pillow to build them).
"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "src" / "act_companion" / "static"
WEB = Path(__file__).resolve().parent
BG, ACCENT, PAGE_BG = "#10111b", "#9184d9", "#161826"

# GitHub Pages cannot send headers, so the policy the local server sends goes in a <meta> tag. Moodle is the only
# other site the page talks to (its API, and course files and images).
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: https://activity.act.edu; connect-src 'self' https://activity.act.edu; "
       "object-src 'none'; base-uri 'none'; form-action 'none'")

APP_HEAD = f"""<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="no-referrer">
"""
HEAD = APP_HEAD + f"""<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<meta name="apple-mobile-web-app-title" content="ACT Companion">
<meta name="theme-color" content="{PAGE_BG}">
"""


def version():
    text = (ROOT / "src" / "act_companion" / "__init__.py").read_text(encoding="utf-8")
    return re.search(r'__version__ = "([^"]+)"', text).group(1)


def icon(size, padded):
    """The app mark, full bleed: a dark square with the accent square in the middle. Home screens round the corners.

    padded: the maskable icon keeps the mark inside the middle 80%, which Android may crop to a circle.
    """
    from PIL import Image, ImageDraw

    scale = 4
    s = size * scale
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    unit = s / 64 * (0.8 if padded else 1)  # icon.svg uses a 64 x 64 viewBox; its accent square is 20 units wide
    half = 10 * unit
    d.rounded_rectangle([s / 2 - half, s / 2 - half, s / 2 + half, s / 2 + half], radius=4 * unit, fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def main(out, app=False):
    out = Path(out)
    v = version()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC, out)

    html = (out / "index.html").read_text(encoding="utf-8")
    html = html.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + (APP_HEAD if app else HEAD), 1)
    # Report the iPhone's notch and home bar to the CSS (the phone tab bar pads itself with env(safe-area-inset-bottom)).
    html = html.replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"', 1)
    html = html.replace('<script src="app.js"></script>', '<script src="web.js"></script>\n<script src="app.js"></script>', 1)
    assert "web.js" in html and "Content-Security-Policy" in html and "viewport-fit" in html, "index.html changed; update web/build.py"
    (out / "index.html").write_text(html, encoding="utf-8")

    (out / "web.js").write_text((WEB / "web.js").read_text(encoding="utf-8").replace("__VERSION__", v), encoding="utf-8")
    if app:
        print(f"Built the web app {v} for the Android app in {out}")
        return
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file() and p.name != "OFL.txt")
    files += ["icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    (out / "sw.js").write_text(sw.replace("__VERSION__", v).replace("__FILES__", json.dumps(["./"] + files)), encoding="utf-8")
    shutil.copy(WEB / "manifest.webmanifest", out / "manifest.webmanifest")

    icon(180, False).save(out / "icon-180.png")
    icon(192, False).save(out / "icon-192.png")
    icon(512, False).save(out / "icon-512.png")
    icon(512, True).save(out / "icon-maskable-512.png")
    (out / ".nojekyll").write_text("", encoding="utf-8")  # serve files as they are
    print(f"Built the web app {v} in {out}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--app"]
    main(args[0] if args else ROOT / "build" / "web", app="--app" in sys.argv[1:])
