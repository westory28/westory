"""Export the approved PNGs without redrawing them. Requires Pillow.

python scripts/export-brand-assets.py <full.png> <we.png>
Only these small exports are served; keep the supplied masters outside the build.
"""
import math
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "src/assets/brand"
ICONS = ROOT / "public/icons"


def trimmed(path):
    image = Image.open(path).convert("RGBA")
    bounds = image.getchannel("A").point(lambda a: 255 if a >= 32 else 0).getbbox()
    if bounds is None:
        raise ValueError("The logo is empty")
    # Leave a two-pixel fringe so antialiasing at the visible edge is retained.
    l, t, r, b = bounds
    return image.crop((max(0, l-2), max(0, t-2), min(image.width, r+2), min(image.height, b+2)))


def resized(image, width):
    return image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)


full, mark = (trimmed(path) for path in sys.argv[1:3])
BRAND.mkdir(parents=True, exist_ok=True)
ICONS.mkdir(parents=True, exist_ok=True)
for image, width, name in [(full, 1024, "westory-wordmark"), (mark, 256, "westory-mark")]:
    resized(image, width).save(BRAND / f"{name}.webp", quality=90, method=6)


def icon(size, fraction, opaque):
    foreground = resized(mark, round(size * fraction))
    result = Image.new("RGBA", (size, size), "white" if opaque else (0, 0, 0, 0))
    result.alpha_composite(foreground, ((size - foreground.width)//2, (size - foreground.height)//2))
    return result.convert("RGB") if opaque else result


for size in [180, 192, 512, 1024]:
    icon(size, .94, True).save(ICONS / f"westory-icon-{size}.png", optimize=True)
# All artwork inside the central 80%-diameter circle, including rectangular masks.
safe_fraction = .79 / math.sqrt(1 + (mark.height / mark.width) ** 2)
icon(512, safe_fraction, True).save(ICONS / "westory-icon-maskable-512.png", optimize=True)
pngs = []
for size in [16, 32, 48]:
    path = ICONS / f"westory-favicon-{size}.png"
    icon(size, (size - 2) / size, False).save(path, optimize=True)
    pngs.append((size, path.read_bytes()))
# Embed the exact transparent PNGs; avoid another round of resampling.
offset = 6 + 16 * len(pngs)
entries = []
for size, data in pngs:
    entries.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
(ROOT / "public/favicon.ico").write_bytes(struct.pack("<HHH", 0, 1, len(pngs)) + b"".join(entries) + b"".join(data for _, data in pngs))
for path in [*BRAND.glob("*.webp"), *ICONS.glob("*.png")]:
    print(f"{path.relative_to(ROOT).as_posix()}: {Image.open(path).size}, {path.stat().st_size:,} bytes")
