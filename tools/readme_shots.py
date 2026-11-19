#!/usr/bin/env python3
"""Frame README screenshots in the iPhone 18 Pro bezel from Apple's iOS 27 UI Kit.

    python3 tools/readme_shots.py SRC_DIR OUT_DIR [--finish Black|Silver|Glacier|Burgundy] [--scale 0.4]
                                  [--kit "ref/apple-ios27/Apple iOS 27 UI Kit.sketch"] [--plain] [--pad 24]

Every PNG in SRC_DIR is a capture of the whole 18 Pro screen, 402x874 points at 3x (1206x2622): headless Chromium
with device metrics 402x874, deviceScaleFactor 3, mobile, an iPhone user agent and the 18 Pro's safe areas
(62 points at the top, 34 at the bottom; CDP Emulation.setSafeAreaInsetsOverride), so the page lays out around the
status bar and the home indicator as it does on the phone. The status bar's area is left to the page; this tool
draws the kit's iOS 27 status bar over it (white, "Dark Background": the app's status bar is black) and the home
indicator at the bottom, adds a soft diagonal sheen (--glare: the bezel has no glare of its own, so the iOS 6 kit's
iPhone 5 glare, toned down from .35 to .2), then puts the screen in the bezel and writes it to OUT_DIR under the same name, with
--pad transparent pixels on the left and right so phones side by side in the README don't touch.

From the kit (a .sketch file is a zip; pages/*.json hold the layers, images/ the bitmaps), read in memory:

- the bezel: symbol "Bezels/iPhone 18 Pro/<finish> - Portrait" (402x874), its bitmap layer
  "iPhone 18 Pro - <finish> - Portrait" (450x920 points at -24,-23; the PNG is 1350x2760, 3x). The bitmap has the
  Dynamic Island and the camera in it, and a see-through screen;
- the status bar: symbol "Status Bars/iPhone 18 Pro/Dark Background" (402x62): the Time text (SF Pro Semibold
  17.67, centred in its frame), Cellular's four bars, Wifi's three paths and Battery's Body and Contact, drawn here
  from their vector points (the Dynamic Island layer in it is skipped: the bezel has it);
- the font: the kit's embedded SF Pro (fonts/, variable; the Semibold instance);
- the home indicator: "Home Indicators/Portrait - Dark - iPhone" (144x5 at 7 in a 20-point strip at the bottom).

Each phone named in LABELS gets its caption drawn under it, in the PNG, so it always sits under its own phone at
the same size: the page's name in white on a blue pill, a short line under it in grey (both read on GitHub's light
and dark themes), in Noto Sans (fc-match). --relabel OUT_DIR... redraws the captions of PNGs this tool already
framed (it keeps the phone, drops any old caption), for when the captures are gone.

--plain skips the phone: the screen with the iOS rounded corners (55 points) and the padding, for when the kit isn't
at hand. The kit and anything taken out of it stay in ref/ (gitignored, AGENTS.md); only the framed PNGs are
committed (Apple publishes these bezels for showing apps). Local tool: needs Pillow, like tools/kitmatch.py; the
test gate doesn't run it.
"""
import argparse
import io
import subprocess
import json
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

SCREEN_PT = (402, 874)
K = 3  # the captures and the bezel bitmap are 3x
STATUS_SYMBOL = "Status Bars/iPhone 18 Pro/Dark Background"
HOME_SYMBOL = "Home Indicators/Portrait - Dark - iPhone"
SCREEN_RADIUS_PT = 55
SS = 4  # supersampling for the vector status bar


# PNG name: (the pill, the line under it).
LABELS = {
    "web-home": ("Home", "install the apps from here"), "web-sources": ("Sources", "APT repos and AltStore sources"),
    "web-app": ("App", "details and what's new"), "web-changes": ("Changes", "updates by day"),
    "jb-home": ("Home", "the jailbreak app"), "jb-sources": ("Sources", "your APT repos"),
    "jb-package": ("Package", "details and versions"), "jb-log": ("Install", "apt's log, live"),
    "web-search": ("Search", "every source at once"), "web-installed-manage": ("Installed", "manage several at once"),
    "web-myipas": ("Install IPAs", "a file or a URL"), "web-theme": ("Theme", "with a live preview"),
    "web-manage": ("Manage", "add and edit sources"), "web-settings": ("Settings", "account, theme, signing"),
    "web-signing": ("Signing", "your certificate"), "jb-installed": ("Installed", "packages, A to Z"),
}
LABEL_H = 150  # caption height at the default --scale (a 588 px wide phone)
SS = 4


def label(title, line, width, height=LABEL_H):
    font = lambda pattern, size: ImageFont.truetype(
        subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True, check=True).stdout, size)
    k = SS * height / LABEL_H
    img = Image.new("RGBA", (round(width * SS), round(height * SS)), (0, 0, 0, 0))
    d, cx = ImageDraw.Draw(img), img.width // 2
    big = font("Noto Sans:bold", round(40 * k))
    top, ph = round(18 * k), round(60 * k)
    pw = round(d.textlength(title, font=big) + 52 * k)
    # the nav bar's blue (sampled off the framed shots, a step darker for the white text), lighter at the top
    pill = Image.composite(Image.new("RGBA", (pw, ph), (66, 92, 128, 255)), Image.new("RGBA", (pw, ph), (116, 141, 176, 255)),
                           Image.linear_gradient("L").resize((pw, ph)))
    mask = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), ph // 2, fill=255)
    img.paste(pill, (cx - pw // 2, top), mask)
    d.text((cx, top + ph // 2), title, font=big, fill=(255, 255, 255, 255), anchor="mm")
    d.text((cx, top + ph + round(34 * k)), line, font=font("Noto Sans", round(30 * k)), fill=(140, 149, 159, 255), anchor="mm")
    return img.resize((round(width), round(height)), Image.LANCZOS)


def with_label(phone, name, scale):
    if name not in LABELS:
        return phone
    lab = label(*LABELS[name], phone.width, round(LABEL_H * scale / 0.4))
    out = Image.new("RGBA", (phone.width, phone.height + lab.height), (0, 0, 0, 0))
    out.alpha_composite(phone)
    out.alpha_composite(lab, (0, phone.height))
    return out


def bezel_symbol(finish):
    return f"Bezels/iPhone 18 Pro/{finish} - Portrait"


class Kit:
    """The parts of the .sketch file this tool uses, read straight from the zip."""

    def __init__(self, path):
        self.zip = zipfile.ZipFile(path)
        self.symbols = {}
        for name in self.zip.namelist():
            if name.startswith("pages/") and name.endswith(".json"):
                self._collect(json.loads(self.zip.read(name)))
        self.doc = json.loads(self.zip.read("document.json"))

    def _collect(self, layer):
        if layer.get("_class") == "symbolMaster":
            self.symbols.setdefault(layer.get("name", ""), layer)
        for child in layer.get("layers") or []:
            self._collect(child)

    def symbol(self, name):
        if name not in self.symbols:
            sys.exit(f"readme_shots: the kit has no symbol {name!r}")
        return self.symbols[name]

    def bezel(self, finish):
        """(RGBA bitmap at 3x, its offset from the screen's top left in points, the layer and file names)."""
        sym = self.symbol(bezel_symbol(finish))
        bmp = next(l for l in sym["layers"] if l["_class"] == "bitmap")
        ref = bmp["image"]["_ref"]
        img = Image.open(io.BytesIO(self.zip.read(ref if "." in ref.rsplit("/", 1)[-1] else ref + ".png"))).convert("RGBA")
        f = bmp["frame"]
        if (round(f["width"]) * K, round(f["height"]) * K) != img.size:
            sys.exit(f"readme_shots: {bmp['name']} is {img.size}, not 3x its {f['width']}x{f['height']} frame")
        return img, (f["x"], f["y"]), bmp["name"], ref

    def font(self, family="SF Pro", style="Semibold", size=17.67):
        for f in self.doc.get("fontReferences", []):
            if f.get("fontFamilyName") == family and "fontData" in f:
                font = ImageFont.truetype(io.BytesIO(self.zip.read(f["fontData"]["_ref"])), round(size * K * SS))
                try:
                    font.set_variation_by_name(style)
                except (OSError, ValueError):
                    pass
                return font
        sys.exit(f"readme_shots: the kit has no embedded {family}")


# ---- Sketch vector paths

def _pt(s):
    x, y = (float(v) for v in re.findall(r"-?[\d.e+-]+", s))
    return x, y


def _cubic(p0, c1, c2, p1, n=16):
    out = []
    for i in range(1, n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]))
    return out


def path_polygon(layer, ox, oy, scale):
    """A shapePath's outline as a polygon, in pixels: its points are fractions of its frame."""
    f = layer["frame"]
    x0, y0, w, h = ox + f["x"], oy + f["y"], f["width"], f["height"]
    pts = layer.get("points", [])
    to = lambda p: ((x0 + p[0] * w) * scale, (y0 + p[1] * h) * scale)
    poly = [to(_pt(pts[0]["point"]))]
    n = len(pts) if layer.get("isClosed", True) else len(pts) - 1
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        pa, pb = _pt(a["point"]), _pt(b["point"])
        if a.get("hasCurveFrom") or b.get("hasCurveTo"):
            c1 = _pt(a["curveFrom"]) if a.get("hasCurveFrom") else pa
            c2 = _pt(b["curveTo"]) if b.get("hasCurveTo") else pb
            poly += [to(p) for p in _cubic(pa, c1, c2, pb)]
        else:
            poly.append(to(pb))
    return poly


def draw_layer(draw, layer, ox, oy, scale, fill):
    cls = layer.get("_class")
    f = layer.get("frame", {})
    if layer.get("isVisible") is False or layer.get("name") == "Dynamic Island":
        return
    if cls == "rectangle":
        r = (layer.get("points") or [{}])[0].get("cornerRadius", 0) or layer.get("fixedRadius", 0) or 0
        box = [(ox + f["x"]) * scale, (oy + f["y"]) * scale, (ox + f["x"] + f["width"]) * scale, (oy + f["y"] + f["height"]) * scale]
        draw.rounded_rectangle(box, radius=r * scale, fill=fill)
    elif cls == "shapePath":
        draw.polygon(path_polygon(layer, ox, oy, scale), fill=fill)
    elif cls in ("group", "shapeGroup"):
        for child in layer.get("layers") or []:
            draw_layer(draw, child, ox + f["x"], oy + f["y"], scale, fill)


def status_bar(kit):
    """The kit's 18 Pro status bar, white on transparent, 402x62 points at 3x."""
    sym = kit.symbol(STATUS_SYMBOL)
    w, h = round(sym["frame"]["width"]), round(sym["frame"]["height"])
    s = K * SS
    layer = Image.new("L", (w * s, h * s), 0)
    d = ImageDraw.Draw(layer)
    for child in sym["layers"]:
        draw_layer(d, child, 0, 0, s, 255)
    # The Time text, centred in its frame (paragraph alignment 2), one 22-point line.
    def texts(l, ox, oy):
        for c in l.get("layers") or []:
            f = c["frame"]
            if c["_class"] == "text":
                yield c, ox + f["x"], oy + f["y"]
            else:
                yield from texts(c, ox + f["x"], oy + f["y"])
    for t, x, y in texts(sym, 0, 0):
        attrs = t["attributedString"]["attributes"][0]["attributes"]
        desc = attrs["MSAttributedStringFontAttribute"]["attributes"]
        style = desc["name"].split("-", 1)[-1]
        font = kit.font("SF Pro", style, desc["size"])
        line = attrs.get("paragraphStyle", {}).get("maximumLineHeight") or t["frame"]["height"]
        ascent, descent = font.getmetrics()
        cx = (x + t["frame"]["width"] / 2) * s
        baseline = y * s + (line * s + ascent - descent) / 2
        d.text((cx, baseline), t["attributedString"]["string"], font=font, fill=255, anchor="ms")
    layer = layer.resize((w * K, h * K), Image.LANCZOS)
    out = Image.new("RGBA", layer.size, (255, 255, 255, 0))
    out.putalpha(layer)
    return out


def home_indicator(kit):
    sym = kit.symbol(HOME_SYMBOL)
    rect = sym["layers"][0]["frame"]
    w, h = round(sym["frame"]["width"]), round(sym["frame"]["height"])
    s = K * SS
    layer = Image.new("L", (w * s, h * s), 0)
    ImageDraw.Draw(layer).rounded_rectangle(
        [rect["x"] * s, rect["y"] * s, (rect["x"] + rect["width"]) * s, (rect["y"] + rect["height"]) * s],
        radius=rect["height"] / 2 * s, fill=255)
    layer = layer.resize((w * K, h * K), Image.LANCZOS)
    out = Image.new("RGBA", layer.size, (255, 255, 255, 0))
    out.putalpha(layer)
    return out


def screen_of(img, kit):
    """A capture as the finished screen: status bar and home indicator drawn on it."""
    img = img.convert("RGBA")
    want = (SCREEN_PT[0] * K, SCREEN_PT[1] * K)
    if img.size != want:
        sys.exit(f"readme_shots: {img.width}x{img.height}: capture the 18 Pro screen at {want[0]}x{want[1]} (see --help)")
    if kit:
        img.alpha_composite(status_bar(kit), (0, 0))
        hi = home_indicator(kit)
        img.alpha_composite(hi, ((want[0] - hi.width) // 2, want[1] - hi.height))
    return img


def screen_hole(bezel):
    """The bezel's see-through screen: the transparent region around the centre, grown a little under the bezel's
    soft inner edge so no gap shows between them."""
    alpha = bezel.getchannel("A")
    clear = alpha.point(lambda a: 255 if a < 128 else 0)
    ImageDraw.floodfill(clear, (bezel.width // 2, bezel.height // 2), 128)
    hole = clear.point(lambda v: 255 if v == 128 else 0)
    return hole.filter(ImageFilter.MaxFilter(5))


def sheen(size, opacity):
    """The screen glare the iOS 6 kit's iPhone 5 had (its "Screen glare": a diagonal from the top right, fading out
    downwards), toned down: the 18 Pro bezel has none of its own. White, peak `opacity`, on a screen-sized layer."""
    w, h = size
    shape = Image.new("L", size, 0)
    ImageDraw.Draw(shape).polygon([(w * 0.42, 0), (w, 0), (w, h * 0.8)], fill=255)
    shape = shape.filter(ImageFilter.GaussianBlur(w * 0.01))  # a soft diagonal edge, not a cut
    fade = Image.linear_gradient("L").resize(size)  # 0 at the top, 255 at the bottom
    full, clear = 0.2, 0.55  # as the kit's gradient: opaque down to a fifth, clear past a little over half
    fade = fade.point(lambda v: round(255 * max(0.0, min(1.0, (clear - v / 255) / (clear - full)))))
    alpha = ImageChops.multiply(shape, fade).point(lambda v: round(v * opacity))
    layer = Image.new("RGBA", size, (255, 255, 255, 0))
    layer.putalpha(alpha)
    return layer


def framed(shot, kit, finish, glare):
    bezel, (ox, oy), _, _ = kit.bezel(finish)
    canvas = Image.new("RGBA", bezel.size, (0, 0, 0, 0))
    at = (round(-ox * K), round(-oy * K))
    under = Image.new("RGBA", bezel.size, (0, 0, 0, 0))
    under.paste(shot, at)
    if glare > 0:
        under.alpha_composite(sheen(shot.size, glare), at)
    canvas.paste(under, (0, 0), ImageChops.multiply(screen_hole(bezel), under.getchannel("A")))
    canvas.alpha_composite(bezel)
    return canvas


def rounded(shot):
    mask = Image.new("L", (shot.width * 2, shot.height * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, mask.width - 1, mask.height - 1], radius=SCREEN_RADIUS_PT * K * 2, fill=255)
    out = shot.copy()
    out.putalpha(mask.resize(shot.size, Image.LANCZOS))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--kit", type=Path,
                    default=Path(__file__).resolve().parent.parent / "ref/apple-ios27/Apple iOS 27 UI Kit.sketch")
    ap.add_argument("--finish", default="Black", choices=["Black", "Silver", "Glacier", "Burgundy"])
    ap.add_argument("--plain", action="store_true", help="no phone: rounded screen corners and padding only")
    # The iOS 6 kit's glare was .35; .2 is the toned-down one the README asked for.
    ap.add_argument("--glare", type=float, default=0.2, help="peak opacity of the screen sheen (0: none)")
    # 0.4 of the 3x bezel (540x1104): sharp at the README's ~200 px per phone on a 2x screen.
    ap.add_argument("--scale", type=float, default=0.4, help="output size, 1.0 = the 3x bezel (1350x2760)")
    ap.add_argument("--pad", type=int, default=24, help="transparent pixels left and right of each phone, at --scale")
    ap.add_argument("--relabel", action="store_true", help="src and out are framed PNGs: redraw their captions")
    a = ap.parse_args()
    if a.relabel:
        a.out.mkdir(parents=True, exist_ok=True)
        for src in sorted(a.src.glob("*.png")):
            if src.stem not in LABELS:
                continue
            img = Image.open(src).convert("RGBA")
            phone = img.crop((0, 0, img.width, round(2760 * a.scale)))  # the 3x bezel is 2760 px tall
            with_label(phone, src.stem, a.scale).save(a.out / src.name, optimize=True)
            print(a.out / src.name)
        return
    kit = None
    if a.kit.exists():
        kit = Kit(a.kit)
    elif not a.plain:
        sys.exit(f"readme_shots: no kit at {a.kit} (ref/ lives in the main checkout; link it, AGENTS.md), or --plain")
    a.out.mkdir(parents=True, exist_ok=True)
    for src in sorted(a.src.glob("*.png")):
        shot = screen_of(Image.open(src), kit)
        img = rounded(shot) if a.plain else framed(shot, kit, a.finish, a.glare)
        img = img.resize((round(img.width * a.scale), round(img.height * a.scale)), Image.LANCZOS)
        padded = Image.new("RGBA", (img.width + 2 * a.pad, img.height), (0, 0, 0, 0))
        padded.alpha_composite(img, (a.pad, 0))
        padded = with_label(padded, src.stem, a.scale)
        dst = a.out / src.name
        padded.save(dst, optimize=True)
        print(f"{dst} {padded.width}x{padded.height} {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
