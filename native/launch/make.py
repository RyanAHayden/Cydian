#!/usr/bin/env python3
"""The launch screen's images (docs/native.md, "Launch screen"): the pieces LaunchScreen.storyboard lays out against
the safe area, so the splash is the page's first frame on every screen (index.html #boot under the app's bars,
web/app/ios6.css with data-shell="app"):

- LaunchStripes: the pinstripes (--pin-dark 2.5 pt, --pin-light 5.5 pt, an 8 pt period), 600 pt wide (wider than
  any iPhone) and 1 pt tall: the storyboard stretches it down the screen at its own width, from the left edge as .boot
  draws them, so the stripes line up with the page's. (A full-screen image is too big: SplashBoard refuses a launch
  screen whose estimated size is over 25,000,000 bytes, and 1800x3600 px of RGBA was 25,924,736.)
- LaunchNavTop / LaunchNavBottom: the nav bar's gloss (#bdcbdc to #597498) cut at its half. The top half is
  stretched over the status-bar strip and the bar's top 22 pt, the bottom half fills the bar's last 22 pt, as
  .navbar::before does in the app.
- LaunchTabGloss: the tab bar's 48 pt gloss (#2f2f2f, #151515 at 49.5 %, then #000), pixel for pixel.
- LaunchNavShadow / LaunchTabShadow: the bars' 2.5 pt shadows, black at 18 % fading out.

The bar lines (highlight, bottom edge) are plain colour views in the storyboard. Stdlib only. Rerun after changing
the colours in ios6.css, then rerun native/launch/storyboard.sh (it compiles the storyboard on a Mac).

    native/launch/make.py [OUT_DIR]   (default: native/launch/)
"""
import pathlib
import struct
import sys
import zlib

HERE = pathlib.Path(__file__).resolve().parent
PIN_DARK, PIN_LIGHT = (0xCB, 0xD0, 0xDA), (0xCE, 0xD3, 0xDC)
STRIPES_PT = (600, 1)  # wider than any iPhone; stretched down the screen
NAV_GLOSS = ((0xBD, 0xCB, 0xDC), (0x59, 0x74, 0x98))
TAB_GLOSS = ((0x2F, 0x2F, 0x2F), (0x15, 0x15, 0x15), 0.495, (0, 0, 0))
GLOSS_PX = 512  # rows in a stretched gloss image


def png(w, h, rows, alpha=False):
    """rows: one bytes row per line (or a single row repeated h times)."""
    if isinstance(rows, (bytes, bytearray)):
        rows = [rows] * h
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)  # noqa: E731
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6 if alpha else 2, 0, 0, 0))
            + chunk(b"sRGB", b"\x00")  # the CSS colours are sRGB: say so, not leave it to the renderer
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def stripes(scale):
    """One row of the pinstripes at this scale: each pixel the share of it the dark stripe covers."""
    w, h = STRIPES_PT[0] * scale, STRIPES_PT[1] * scale
    row = bytearray()
    for x in range(w):
        a = x / scale % 8  # the pixel's span in pt, within the period (8 pt is a whole number of pixels)
        dark = max(0.0, min(a + 1 / scale, 2.5) - a) * scale
        row += bytes(mix(PIN_LIGHT, PIN_DARK, dark))
    return png(w, h, bytes(row))


def column(colours, h, alpha=False):
    """A 1 px wide image, h rows, colours[i] for row i."""
    return png(1, h, [bytes(c) for c in colours], alpha)


def nav_half(top):
    lo, hi = (0.0, 0.5) if top else (0.5, 1.0)
    return column([mix(*NAV_GLOSS, lo + (hi - lo) * (i + 0.5) / GLOSS_PX) for i in range(GLOSS_PX)], GLOSS_PX)


def tab_gloss(scale):
    c0, c1, stop, c2 = TAB_GLOSS
    h = 48 * scale
    out = []
    for i in range(h):
        t = (i + 0.5) / h
        out.append(mix(c0, c1, t / stop) if t < stop else c2)
    return column(out, h)


def shadow(scale, down):
    """2.5 pt of black, 18 % at the bar's edge to 0; down: the nav bar's (edge at the top)."""
    h = max(1, round(2.5 * scale))
    out = []
    for i in range(h):
        t = (i + 0.5) / h
        a = round(255 * 0.18 * ((1 - t) if down else t))
        out.append((0, 0, 0, a))
    return column(out, h, alpha=True)


def images():
    """{file name: PNG bytes} for every launch image."""
    out = {}
    for s in (2, 3):
        x = "@%dx" % s
        out["LaunchStripes" + x] = stripes(s)
        out["LaunchNavTop" + x] = nav_half(True)
        out["LaunchNavBottom" + x] = nav_half(False)
        out["LaunchTabGloss" + x] = tab_gloss(s)
        out["LaunchNavShadow" + x] = shadow(s, True)
        out["LaunchTabShadow" + x] = shadow(s, False)
    return {k + ".png": v for k, v in out.items()}


def main(out=HERE):
    out = pathlib.Path(out)
    for name, data in images().items():
        (out / name).write_bytes(data)
    print("launch:", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else HERE)
