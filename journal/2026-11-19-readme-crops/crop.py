#!/usr/bin/env python3
"""README crops: one part of a page under its nav bar, so you see where it is.

    python3 crop.py RAW_DIR OUT_DIR

RAW_DIR holds capture.mjs's 3x shots (402x874 points). Each crop stacks the page's nav bar (points 62-106, under the
status bar's safe area) on a band of the page, as if the page were scrolled to it; the band's bottom fades out and
the top corners are rounded, so it sits on GitHub's light or dark page. Written at 2x. Local tool (Pillow).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

K = 3       # capture scale
OUT = 2     # output scale
NAV = (62, 106)
FADE = 14   # points of fade at the bottom: end each band this far below its last text, on blank page
RADIUS = 14

# name: (shot, band top, band bottom) in points; a band starting at the nav bar's bottom is just one cut.
CROPS = {
    "crop-web-certificate": ("signing", 106, 292),
    "crop-web-lite": ("home", 300, 508),
    "crop-jb-sheet": ("jb-sheet", 436, 834),
    "crop-share-certificate": ("signing", 474, 644),
    "crop-signing-server": ("sl-signing", 352, 531),
    "crop-account": ("account", 106, 338),
}


def crop(src, top, bottom):
    im = Image.open(src).convert("RGBA")
    w = im.width
    nav = im.crop((0, NAV[0] * K, w, NAV[1] * K))
    band = im.crop((0, top * K, w, bottom * K))
    out = Image.new("RGBA", (w, nav.height + band.height))
    out.paste(band, (0, nav.height))
    out.paste(nav, (0, 0))  # over the band: the nav bar's shadow falls on it as on the page
    alpha = Image.new("L", out.size, 255)
    d = ImageDraw.Draw(alpha)
    f = FADE * K
    for i in range(f):
        d.line([(0, out.height - f + i), (w, out.height - f + i)], fill=round(255 * (1 - (i + 1) / f) ** 1.6))
    mask = Image.new("L", out.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, out.height + RADIUS * K), RADIUS * K, fill=255)
    out.putalpha(Image.composite(alpha, Image.new("L", out.size, 0), mask))
    return out.resize((w * OUT // K, out.height * OUT // K), Image.LANCZOS)


if __name__ == "__main__":
    raw, dst = Path(sys.argv[1]), Path(sys.argv[2])
    for name, (shot, top, bottom) in CROPS.items():
        crop(raw / f"{shot}.png", top, bottom).save(dst / f"{name}.png", optimize=True)
        print(name)
