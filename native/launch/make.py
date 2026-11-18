#!/usr/bin/env python3
"""The native app's launch screen images (N10), cut from the website's launch images (tools/launch_images.py,
web/app/icons/launch/), with the stdlib only. Info.plist's UILaunchScreen names them; build.sh copies them into
Cydian.app as loose PNGs (no asset catalog: docs/native.md, "Launch screen").

    native/launch/make.py [OUT_DIR]   (default: native/launch/; rerun when the website's launch images change)

Writes, each at @2x (from launch-828x1792.png) and @3x (from launch-1179x2556.png):
  LaunchNavBar   the nav bar's 44 pt below the status bar: its gradient, top highlight and bottom line (no title),
                 one point wide: UIKit stretches a bar's background image across the bar
  LaunchTabBar   the tab bar's 49 pt above the home indicator: its two-tone black (no icons), one point wide
  LaunchLoading  the pinstripes with the Loading spinner and label in the middle, 440x956 pt at @3x and 414x896 pt at
                 @2x (the biggest screen of each scale), so centred on any screen it fills it
"""
import os
import pathlib
import struct
import sys
import zlib

HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parent.parent / "web" / "app" / "icons" / "launch"

# source file, scale, top inset pt, bottom inset pt, screen pt (w, h); the insets are tools/launch_images.py's.
SOURCES = {2: ("launch-828x1792.png", 48, 34, (414, 896)), 3: ("launch-1179x2556.png", 59, 34, (393, 852))}
LOADING_PT = {2: (414, 896), 3: (440, 956)}
NAV_PT, TAB_PT = 44, 49
PERIOD_PT = 8  # the pinstripes' period (web/app/ios6.css --pin-dark/--pin-light)


# ---------- PNG, 8-bit RGB/RGBA, not interlaced ----------

def read_png(path):
    """(width, height, rows): rows a list of bytes, 3 bytes (RGB) per pixel."""
    data = pathlib.Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s: not a PNG" % path)
    pos, idat, head = 8, b"", None
    while pos < len(data):
        n, kind = struct.unpack_from(">I4s", data, pos)
        body = data[pos + 8:pos + 8 + n]
        if kind == b"IHDR":
            head = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + n
    w, h, depth, ctype, _, _, interlace = head
    if depth != 8 or ctype not in (2, 6) or interlace:
        raise ValueError("%s: want 8-bit RGB/RGBA, not interlaced" % path)
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                line[i] = (line[i] + ((line[i - bpp] if i >= bpp else 0) + prev[i]) // 2) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b, c = prev[i], (prev[i - bpp] if i >= bpp else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        if bpp == 4:
            line = bytearray(b for i, b in enumerate(line) if i % 4 != 3)
        rows.append(bytes(line))
    return w, h, rows


def write_png(path, w, rows):
    """RGB rows to a PNG, filter Up (the pinstripes' rows repeat, so they pack to almost nothing)."""
    out, prev = bytearray(), bytes(3 * w)
    for r in rows:
        out.append(2)
        out += bytes((a - b) & 255 for a, b in zip(r, prev))
        prev = r

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, len(rows), 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(out), 9)) + chunk(b"IEND", b""))
    pathlib.Path(path).write_bytes(png)


# ---------- the images ----------

def column(rows, x, y0, y1, width):
    return [r[3 * x:3 * (x + width)] for r in rows[y0:y1]]


def loading(rows, w, h, s, top, bottom, out_pt):
    """The pinstripes at out_pt with the source's Loading block in the middle, the stripes kept in phase."""
    y0, y1 = (top + NAV_PT) * s, h - (bottom + TAB_PT) * s  # the page between the bars
    mid = (y0 + y1) // 2
    # A row 60 pt above the middle: plain stripes (the top of the page has the nav bar's shadow, so not there).
    stripe = rows[mid - 60 * s]
    # The Loading block, within 40 pt of the middle: the rows that are not plain stripes, and the columns in them
    # that differ from the stripes.
    ys = [y for y in range(mid - 40 * s, mid + 40 * s) if rows[y] != stripe]
    xs = [x for x in range(w) if any(rows[y][3 * x:3 * x + 3] != stripe[3 * x:3 * x + 3] for y in ys[::2])]
    bx0, bx1, by0, by1 = min(xs) - 2 * s, max(xs) + 1 + 2 * s, ys[0] - 2 * s, ys[-1] + 1 + 2 * s
    ow, oh = out_pt[0] * s, out_pt[1] * s
    # Centred: the screen's left edge sits at dx in the image; stripe column X is the source's X - dx.
    dx = (ow - w) // 2
    period = PERIOD_PT * s
    line = bytes(b for X in range(ow) for b in stripe[3 * ((X - dx) % period):3 * ((X - dx) % period) + 3])
    out = [line] * oh
    # The block keeps its offset from the middle of the page: the page's middle goes to the image's middle.
    dy = oh // 2 - mid
    for y in range(by0, by1):
        r = bytearray(line)
        r[3 * (bx0 + dx):3 * (bx1 + dx)] = rows[y][3 * bx0:3 * bx1]
        out[y + dy] = bytes(r)
    return ow, out


def main(out):
    os.makedirs(out, exist_ok=True)
    for s, (name, top, bottom, _) in SOURCES.items():
        w, h, rows = read_png(WEB / name)
        x = 2 * s  # left of the title and the Home tab's highlight: plain bar
        write_png(os.path.join(out, "LaunchNavBar@%dx.png" % s), s, column(rows, x, top * s, (top + NAV_PT) * s, s))
        tab0 = h - (bottom + TAB_PT) * s
        write_png(os.path.join(out, "LaunchTabBar@%dx.png" % s), s, column(rows, 1, tab0, tab0 + TAB_PT * s, s))
        ow, img = loading(rows, w, h, s, top, bottom, LOADING_PT[s])
        write_png(os.path.join(out, "LaunchLoading@%dx.png" % s), ow, img)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(HERE))
    print("launch images:", sys.argv[1] if len(sys.argv) > 1 else HERE)
