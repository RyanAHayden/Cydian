#!/usr/bin/env python3
"""F166: compare web/app/nav/spinner.js's spinners with the 4S's UIActivityIndicatorView frames.

Local reference tool (Pillow, rsvg-convert, node; needs ref/ linked in). Renders each style at the 4S's @2x size,
composites both on a background like the one it sits on, prints the per-pixel difference in levels, and writes a
4x side-by-side (4S left, ours right) to the path given (default journal/2026-11-18-f166-spinners/compare-4x.png).
"""
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "ref/4s/artwork/Shared@2x/UIActivityIndicatorViewStyle{}.0.png"
# style in spinner.js, UIKit's name, @2x pixels, a background it sits on, mid-spoke radius (pt)
STYLES = [("white", "White", 40, (110, 130, 160), 7.5), ("gray", "Gray", 40, (235, 235, 240), 7.5),
          ("large", "WhiteLarge", 74, (60, 60, 60), 13)]


def svg(kind):
    js = f'import {{ spinnerSVG }} from "./web/app/nav/spinner.js"; process.stdout.write(spinnerSVG("{kind}"))'
    return subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def main(out):
    rows, worst = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for kind, name, px, bg, rmid in STYLES:
            src, png = Path(tmp, kind + ".svg"), Path(tmp, kind + ".png")
            src.write_text(svg(kind))
            subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), "-o", str(png), str(src)], check=True)
            a, b = Image.open(str(REF).format(name)).convert("RGBA"), Image.open(png).convert("RGBA")
            ca, cb = Image.new("RGBA", a.size, bg + (255,)), Image.new("RGBA", b.size, bg + (255,))
            ca.alpha_composite(a)
            cb.alpha_composite(b)
            d = sorted(max(p) for p in ImageChops.difference(ca.convert("RGB"), cb.convert("RGB")).getdata())
            c, r = px / 2, rmid * 2
            spot = [(int(c + r * math.sin(math.radians(30 * i))), int(c - r * math.cos(math.radians(30 * i)))) for i in range(12)]
            print(f"{kind}: mean {sum(d) / len(d):.2f}, 99th pct {d[int(len(d) * .99)]}, max {d[-1]} levels on rgb{bg}; "
                  f"mid-spoke alpha 4S {[a.getpixel(s)[3] for s in spot]} ours {[b.getpixel(s)[3] for s in spot]}")
            worst = max(worst, d[int(len(d) * .99)])
            z = 4
            row = Image.new("RGB", (px * z * 2 + 30, px * z + 20), (255, 255, 255))
            row.paste(ca.convert("RGB").resize((px * z, px * z), Image.NEAREST), (10, 10))
            row.paste(cb.convert("RGB").resize((px * z, px * z), Image.NEAREST), (px * z + 20, 10))
            rows.append(row)
    img = Image.new("RGB", (max(r.width for r in rows), sum(r.height for r in rows)), (255, 255, 255))
    y = 0
    for r in rows:
        img.paste(r, (0, y))
        y += r.height
    img.save(out)
    print(out)
    return worst


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "journal/2026-11-18-f166-spinners/compare-4x.png"))
