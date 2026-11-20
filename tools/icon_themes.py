#!/usr/bin/env python3
"""iFizBox's icon in each theme's colours: one master SVG per theme, the same drawing as web/app/icons/icon.svg
(tools/icon.svg.in) with its own background and globe colours.

- Dark themes: the blue glass globe on a bright-centred radial light ("R2", Gunmetal's), recoloured per theme around
  its accent. OLED Black takes the near-black starburst with a blue burst instead.
- Light themes: today's starburst. Classic is the real icon unchanged; Sepia and Solarized recolour its ramp along its
  own brightness, with a white globe inked in the theme's colour.

The theme table is THEMES below; its names must be theme-boot.js's `darks` and `lights` (checked on every run).
Backgrounds come from tools/icon_bg.py's generator (same noise and seed), so the rays line up across themes.

    tools/icon_themes.py OUTDIR    writes OUTDIR/<theme>.svg for every theme (tools/icons.sh sashes and renders them)
    tools/icon_themes.py --names   prints the theme names, one per line, in theme-boot.js's order

Needs numpy, scipy and Pillow (as icon_bg.py); run by tools/icons.sh, not by the gate.
"""
import base64
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOT = os.path.join(ROOT, "web/app/theme-boot.js")
TEMPLATE = os.path.join(ROOT, "tools/icon.svg.in")
MASTER = os.path.join(ROOT, "web/app/icons/icon.svg")  # Classic: tools/icons.sh writes it before calling this


def hx(c):
    return [int(c[i:i + 2], 16) for i in (0, 2, 4)]


def mix(a, b, t):
    """Hex colour a toward b by t (0..1), no '#'."""
    return "%02x%02x%02x" % tuple(round(x * (1 - t) + y * t) for x, y in zip(hx(a), hx(b)))


def lum(c):
    r, g, b = hx(c)
    return (.3 * r + .59 * g + .11 * b) / 255


def ramp(top, mid, low):
    """A dark theme's top-to-bottom ramp: its light ground at the top, darkest just below the middle."""
    return [(0, top), (.3, mix(top, mid, .6)), (.45, low), (.55, mid), (1, mix(mid, top, .4))]


def glass(acc):
    """The R2 glass globe's (sphere, rim, ink) gradients recoloured around a theme's accent."""
    a = acc.lstrip("#")
    k = lambda t: "#" + mix("000000", a, t)  # noqa: E731  accent toward black
    w = lambda t: "#" + mix(a, "ffffff", t)  # noqa: E731  accent toward white
    return (k(.95), k(.6), k(.32)), (w(.55), k(.45)), (w(.85), w(.55))


# The Classic icon's ramp (tools/icon_bg.py STOPS), the base the light themes recolour.
_ORIG = []


def _orig():
    """Read once, before bg_*() repoint icon_bg.STOPS at a theme's ramp."""
    if not _ORIG:
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import icon_bg
        _ORIG.extend(icon_bg.STOPS)
    return _ORIG


def tone(dark, light):
    """Today's starburst ramp recoloured from `dark` to `light` along its own brightness."""
    return [(p, mix(dark, light, min(1, lum(c) * 1.25))) for p, c in _orig()]


GUNMETAL = [(0, "4a4f58"), (.5, "30343b"), (1, "3b3f46")]
OLED = [(0, "30343a"), (.14, "212429"), (.3, "16181c"), (.45, "060708"), (.55, "0b0c0e"), (1, "15171b")]
WHITE_GLOBE = (("#fffaf0", "#f3e6cc", "#d8c29c"), ("#fffaf2", "#e2d1b0"))

# name -> recipe. "radial": R2 (stops, centre light, globe accent). "burst": black starburst with a coloured burst.
# "tone": light starburst (dark, light, sphere, rim, ink). "classic": the real icon.
THEMES = {
    "oled": ("burst", OLED, (60, 140, 255), "#2f87ff"),
    "gunmetal": ("radial", GUNMETAL, (120, 200, 255), "#1a78d0"),
    "midnight": ("radial", ramp("1d3256", "0f1d36", "050b16"), (90, 160, 255), "#2a72e0"),
    "linen": ("radial", ramp("4a4c52", "36383d", "1e1f22"), (190, 205, 230), "#3d78c8"),
    "nord": ("radial", ramp("434c5e", "2e3440", "1f232c"), (136, 192, 208), "#4c8fa8"),
    "dracula": ("radial", ramp("44475a", "282a36", "16171e"), (189, 147, 249), "#8a5cd8"),
    "classic": ("classic",),
    "sepia": ("tone", "3a240e", "f6dfb2", *WHITE_GLOBE, ("#6b4f30", "#4f381f")),
    "solarized": ("tone", "073642", "8fd8f0", ("#fdf6e3", "#eee8d5", "#d5ceb8"), ("#fffcf2", "#e4dcc4"),
                  ("#268bd2", "#1b6fab")),
}


def boot_names():
    """theme-boot.js's dark then light theme names, in its order."""
    js = open(BOOT).read()
    names = []
    for var in ("darks", "lights"):
        m = re.search(var + r"\s*=\s*\[([^\]]*)\]", js)
        if not m:
            raise SystemExit("icon_themes: no `%s` list in %s" % (var, BOOT))
        names += re.findall(r'"([a-z0-9-]+)"', m.group(1))
    return names


def names():
    want = boot_names()
    missing = [n for n in want if n not in THEMES]
    extra = [n for n in THEMES if n not in want]
    if missing or extra:
        raise SystemExit("icon_themes: THEMES must match theme-boot.js; missing %s, not a theme %s" % (missing, extra))
    return want


def _jpeg(img):
    from PIL import Image
    import numpy as np
    out = io.BytesIO()
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out, "JPEG", quality=90)
    return out.getvalue()


def bg_burst(stops, faint, burst, tint):
    """A starburst like icon_bg.py's, on another ramp, its rays lifted toward `tint`."""
    import numpy as np
    import icon_bg as ib
    ib.STOPS, ib.CY = stops, 540
    base = ib.gradient()
    ray, r, y = ib.rays()
    reach = np.clip((y - 0.42) / 0.12, 0, 1) * 0.75 + 0.25
    lift = ray * (faint * reach + burst * np.exp(-((r / 360.0) ** 2)) * 1.1)
    img = base + (np.array(tint, float) - base) * lift[..., None]
    img *= (1 - 0.18 * np.clip((r - 430) / 320, 0, 1))[..., None]
    return _jpeg(img)


def bg_radial(stops, glow, core=.55, reach=380, faint=.06, burst=.6, tint=(150, 210, 255)):
    """R2's background: a big radial light in the middle under the rays, dark edges."""
    import numpy as np
    import icon_bg as ib
    ib.STOPS, ib.CY = stops, 540
    base = ib.gradient()
    ray, r, y = ib.rays()
    light = np.exp(-((r / reach) ** 2)) * core
    img = base + (np.array(glow, float) - base) * light[..., None]
    lift = ray * (faint + burst * np.exp(-((r / 330.0) ** 2)))
    img = img + (np.array(tint, float) - img) * lift[..., None]
    img *= (1 - 0.45 * np.clip((r - 300) / 420, 0, 1))[..., None]
    return _jpeg(img)


def svg(jpeg, sph, rim, ink, shadow=".7", glow=None):
    """tools/icon.svg.in with this background and globe colours (and an optional soft halo behind the globe)."""
    a = open(TEMPLATE).read().replace("@BG@", base64.b64encode(jpeg).decode())
    a = a.replace('stop-color="#f7f8fa"/><stop offset=".6" stop-color="#e3e7ec"/><stop offset="1" stop-color="#bcc4ce"',
                  'stop-color="%s"/><stop offset=".6" stop-color="%s"/><stop offset="1" stop-color="%s"' % sph)
    a = a.replace('<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d3d9e0"/>',
                  '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/>' % rim)
    a = a.replace('stop-color="#5a6473"/><stop offset="1" stop-color="#434c59"',
                  'stop-color="%s"/><stop offset="1" stop-color="%s"' % ink)
    a = a.replace('fill="#00203f" opacity=".45"', 'fill="#000" opacity="%s"' % shadow)
    if glow:
        a = a.replace('<circle cx="512" cy="536"', '<circle cx="512" cy="520" r="330" fill="%s" opacity=".35" '
                      'filter="url(#gl)"/><circle cx="512" cy="536"' % glow, 1)
        a = a.replace("</defs>", '<filter id="gl" x="-50%" y="-50%" width="200%" height="200%">'
                      '<feGaussianBlur stdDeviation="40"/></filter></defs>')
    return a


def render(name):
    kind, *p = THEMES[name]
    if kind == "classic":
        return open(MASTER).read()
    if kind == "tone":
        dark, light, sph, rim, ink = p
        return svg(bg_burst(tone(dark, light), .16, .55, (255, 255, 255)), sph, rim, ink, shadow=".45")
    stops, g, acc = p
    halo = "#%02x%02x%02x" % g
    if kind == "burst":
        jpeg = bg_burst(stops, .05, .6, (40, 150, 255))
    else:
        jpeg = bg_radial(stops, glow=g, core=.55, tint=tuple(min(255, int(x * 1.1) + 20) for x in g))
    return svg(jpeg, *glass(acc), glow=halo)


def main(argv):
    if argv == ["--names"]:
        print("\n".join(names()))
        return
    if len(argv) != 1:
        raise SystemExit(__doc__)
    _orig()  # also puts tools/ on sys.path for icon_bg
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    for n in names():
        with open(os.path.join(out, n + ".svg"), "w") as f:
            f.write(render(n))
        print("icon_themes:", os.path.join(out, n + ".svg"))


if __name__ == "__main__":
    main(sys.argv[1:])
