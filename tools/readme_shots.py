#!/usr/bin/env python3
"""Frame README screenshots in the iPhone 5 from the Teehan+Lax iOS 6 kit (F174).

    python3 tools/readme_shots.py SRC_DIR OUT_DIR [--kit ref/teehanlax/ios6] [--scale 0.6]

Every PNG in SRC_DIR goes into the kit's "iPhone 5 Portrait" (ref/teehanlax/ios6/sheet.svg: base phone img-hd/04.png,
screen at 66,237 of its 762x1596, the earphone and camera, the "Screen glare" and the shadow under it) and is written
to OUT_DIR under the same name, optimised. A capture fits the iPhone 5's screen, 320x568 points at 2x:

- 640x1136: the whole screen, used as it is;
- 640x1096 (320x548 points): the page alone; an iOS 6 status bar (black, as the app asks for) is drawn above it;
- 750x1334 (the iPhone 7 test phone, docs/iphone7.md): its iOS 15 status bar (the top 40 px) is replaced by the
  iOS 6 one and the rest is fitted to 640x1096 (both are 16:9, so it scales by 0.853 with under 1% of squeeze).

Capturing the website at that size: headless Chromium with device metrics 320x548, deviceScaleFactor 2, mobile and an
iPhone user agent, against `node worker/node.mjs` (journal/2026-11-18-f174-readme/ has the driver used for F174).

The kit's bitmaps stay in ref/ (gitignored, AGENTS.md); only the framed PNGs are committed. Local tool: needs Pillow,
like tools/kitmatch.py; the test gate doesn't run it.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

# The phone's group in sheet.svg, in sheet units (2x points), relative to the base phone at 1869,65.
PHONE = (762, 1596)
SCREEN = (66, 237, 640, 1136)
EARPHONE = ("35.png", 316, 131, 139, 30)
CAMERA = ("36.png", 372, 73, 27, 27)
SHADOW = ("03.png", 4, 1586, 769, 18, 0.8)
# "Screen glare": shape_14 (opacity .35) masked by img/34.png at 328,25 (417x1189), filled with gradient_9.
GLARE_PATH_START = (329, 26)
GLARE_MASK_AT = (328, 25)
GLARE_OPACITY = 0.35
CANVAS = (773, 1604)  # the phone plus the shadow under it (the reflection is left out)
STATUS_H = 40  # 20 points at 2x


def glare_polygon():
    """shape_14: M 2198,91 L 2500,91 C 2576.74,91 2613,128.67 2613,205 L 2613,1277 Z, relative to the phone."""
    ox, oy = 1869, 65
    p0, c1, c2, p1 = (2500, 91), (2576.74, 91), (2613, 128.67), (2613, 205)
    pts = [(2198, 91), p0]
    for i in range(1, 25):
        t = i / 24
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * c1[0] + 3 * (1 - t) * t * t * c2[0] + t ** 3 * p1[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * c1[1] + 3 * (1 - t) * t * t * c2[1] + t ** 3 * p1[1]
        pts.append((x, y))
    pts.append((2613, 1277))
    return [((x - ox), (y - oy)) for x, y in pts]


def glare_layer(kit, k):
    """The glare as a white RGBA layer at scale k (k=2 for img-hd resolution)."""
    poly = [(x * k, y * k) for x, y in glare_polygon()]
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    top, bottom = min(ys), max(ys)
    clip = Image.new("L", (CANVAS[0] * k, CANVAS[1] * k), 0)
    ImageDraw.Draw(clip).polygon(poly, fill=255)
    # gradient_9: rotate(-90) then scale(1 .3507) about the box centre: clear below 60.5% of the box height,
    # opaque above 32.5%, linear between (the 20% stop is the clear end).
    grad = Image.new("L", clip.size, 0)
    gd = ImageDraw.Draw(grad)
    h = bottom - top
    y_clear, y_full = top + h * (0.5 + 0.5 * 0.3507 - 0.2 * 0.3507), top + h * (0.5 - 0.5 * 0.3507)
    for y in range(int(top), int(bottom) + 1):
        a = (y_clear - y) / (y_clear - y_full)
        gd.line([(min(xs), y), (max(xs), y)], fill=round(255 * max(0.0, min(1.0, a))))
    mask_src = Image.open(kit / "img" / "34.png").convert("L")
    mask = Image.new("L", clip.size, 0)
    mask.paste(mask_src.resize((mask_src.width * k, mask_src.height * k), Image.LANCZOS),
               (GLARE_MASK_AT[0] * k, GLARE_MASK_AT[1] * k))
    alpha = Image.new("L", clip.size, round(255 * GLARE_OPACITY))
    for m in (clip, grad, mask):
        alpha = ImageChops.multiply(alpha, m)
    layer = Image.new("RGBA", clip.size, (255, 255, 255, 0))
    layer.putalpha(alpha)
    return layer


def font(bold=True, size=24):
    for path in ("~/.local/share/fonts/apple/HelveticaNeue.ttc", "/usr/share/fonts/apple/HelveticaNeue.ttc",
                 "/System/Library/Fonts/HelveticaNeue.ttc"):
        p = Path(path).expanduser()
        if p.exists():
            return ImageFont.truetype(str(p), size, index=1 if bold else 0)
    sys.exit("readme_shots: Helvetica Neue not found (README screenshots use the system font of iOS 6)")


def status_bar(width=640):
    """iOS 6's status bar, opaque black, drawn as tools/og.html draws it: signal bars and Carrier, 9:41 AM, 100% and
    a battery. No Apple artwork: plain shapes and Helvetica Neue Bold 12 pt."""
    bar = Image.new("RGB", (width, STATUS_H), (0, 0, 0))
    d = ImageDraw.Draw(bar)
    f = font(True, 24)
    x = 10
    for hgt in (6, 10, 14, 18, 20):  # 3..10 pt bars, 1 pt apart
        d.rectangle([x, 30 - hgt, x + 5, 29], fill="white")
        x += 8
    d.text((x + 6, 20), "Carrier", font=f, fill="white", anchor="lm")
    d.text((width / 2, 20), "9:41 AM", font=f, fill="white", anchor="mm")
    bx = width - 10 - 48  # battery: 22x10 pt outline, 2 pt nub
    d.rounded_rectangle([bx, 10, bx + 43, 29], radius=4, outline="white", width=2)
    d.rectangle([bx + 5, 15, bx + 38, 24], fill="white")
    d.rectangle([bx + 45, 15, bx + 48, 24], fill="white")
    d.text((bx - 8, 20), "100%", font=f, fill="white", anchor="rm")
    return bar


def fit_screen(img):
    """A capture as the iPhone 5's 640x1136 screen."""
    img = img.convert("RGB")
    w, h = img.size
    if (w, h) == (640, 1136):
        return img
    if (w, h) == (750, 1334):
        img = img.crop((0, STATUS_H, 750, 1334)).resize((640, 1136 - STATUS_H), Image.LANCZOS)
    elif (w, h) != (640, 1136 - STATUS_H):
        sys.exit(f"readme_shots: {w}x{h}: capture at 640x1136, 640x1096 or 750x1334 (see --help)")
    screen = Image.new("RGB", (640, 1136))
    screen.paste(status_bar(), (0, 0))
    screen.paste(img, (0, STATUS_H))
    return screen


def frame(shot, kit, scale):
    k = 2  # compose at img-hd resolution, then scale down
    hd = kit / "img-hd"
    canvas = Image.new("RGBA", (CANVAS[0] * k, CANVAS[1] * k), (0, 0, 0, 0))
    name, x, y, w, h, op = SHADOW
    sh = Image.open(hd / name).convert("RGBA").resize((w * k, h * k), Image.LANCZOS)
    sh.putalpha(sh.getchannel("A").point(lambda a: round(a * op)))
    canvas.alpha_composite(sh, (x * k, y * k))
    phone = Image.open(hd / "04.png").convert("RGBA")
    canvas.alpha_composite(phone.resize((PHONE[0] * k, PHONE[1] * k), Image.LANCZOS), (0, 0))
    sx, sy, sw, shh = SCREEN
    canvas.paste(shot.resize((sw * k, shh * k), Image.LANCZOS), (sx * k, sy * k))
    canvas.alpha_composite(glare_layer(kit, k))
    for name, x, y, w, h in (EARPHONE, CAMERA):
        canvas.alpha_composite(Image.open(hd / name).convert("RGBA").resize((w * k, h * k), Image.LANCZOS), (x * k, y * k))
    out = (round(CANVAS[0] * scale), round(CANVAS[1] * scale))
    return canvas.resize(out, Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--kit", type=Path, default=Path(__file__).resolve().parent.parent / "ref/teehanlax/ios6")
    # 0.6 (464x962): sharp at the README's ~250 px per phone on a 2x screen, ~250 KB each. Quantising to 256 colours
    # (--colors) is 8x smaller but bands the icon reflections and the glare, so the README keeps full colour.
    ap.add_argument("--scale", type=float, default=0.6, help="output size, 1.0 = the kit's 773x1604 (default 0.6)")
    ap.add_argument("--colors", type=int, default=0, help="quantise to this many colours (0: keep full colour)")
    a = ap.parse_args()
    if not (a.kit / "img-hd" / "04.png").exists():
        sys.exit(f"readme_shots: no kit at {a.kit} (ref/ lives in the main checkout; link it, AGENTS.md)")
    a.out.mkdir(parents=True, exist_ok=True)
    for src in sorted(a.src.glob("*.png")):
        img = frame(fit_screen(Image.open(src)), a.kit, a.scale)
        if a.colors:
            img = img.quantize(colors=a.colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        dst = a.out / src.name
        img.save(dst, optimize=True)
        print(f"{dst} {img.width}x{img.height} {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
