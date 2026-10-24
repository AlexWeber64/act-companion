"""Draw the app mark from static/icon.svg as a Windows .ico: a dark rounded square with an accent square in the middle."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG, ACCENT = "#10111b", "#9184d9"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def draw(size):
    scale = 4  # draw large, then downsample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = s / 64  # icon.svg uses a 64 x 64 viewBox
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=14 * unit, fill=BG)
    d.rounded_rectangle([22 * unit, 22 * unit, 42 * unit, 42 * unit], radius=4 * unit, fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def main(out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    images = [draw(n) for n in SIZES]
    images[-1].save(out, format="ICO", sizes=[(n, n) for n in SIZES], append_images=images[:-1])
    return out


if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else "build/act-companion.ico"))
