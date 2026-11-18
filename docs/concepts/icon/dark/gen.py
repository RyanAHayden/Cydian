# Dark-mode icon concepts (shelved 2026-11-18). Run from an empty folder: python3 -I PATH/TO/gen.py, then
# for f in [1-6]-*.svg; do rsvg-convert -w 512 "$f" -o "${f%.svg}.png"; done   (writes b*.jpg, 1-6 *.svg)
import sys, base64, re
import os; R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../..'); sys.path.insert(0, R + '/tools')
import numpy as np
from PIL import Image
import icon_bg as ib

def bg(stops, out, faint=0.06, burst=0.30, tint=(255,255,255), cy=540):
    ib.STOPS = stops; ib.CY = cy
    base = ib.gradient(); ray, r, y = ib.rays()
    reach = np.clip((y - 0.42) / 0.12, 0, 1) * 0.75 + 0.25
    lift = ray * (faint * reach + burst * np.exp(-((r / 360.0) ** 2)) * 1.1)
    t = np.array(tint, float)
    img = base + (t - base) * lift[..., None]
    img *= (1 - 0.18 * np.clip((r - 430) / 320, 0, 1))[..., None]
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out, quality=90)

T = open(R + '/tools/icon.svg.in').read()
def svg(name, bgfile, sph, rim, ink, shadow=".7", glow=None):
    a = T.replace('@BG@', base64.b64encode(open(bgfile, 'rb').read()).decode())
    a = a.replace('stop-color="#f7f8fa"/><stop offset=".6" stop-color="#e3e7ec"/><stop offset="1" stop-color="#bcc4ce"',
                  'stop-color="%s"/><stop offset=".6" stop-color="%s"/><stop offset="1" stop-color="%s"' % sph)
    a = a.replace('<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d3d9e0"/>',
                  '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/>' % rim)
    a = a.replace('stop-color="#5a6473"/><stop offset="1" stop-color="#434c59"', 'stop-color="%s"/><stop offset="1" stop-color="%s"' % ink)
    a = a.replace('fill="#00203f" opacity=".45"', 'fill="#000" opacity="%s"' % shadow)
    if glow:  # soft coloured halo behind the globe
        a = a.replace('<circle cx="512" cy="536"', '<circle cx="512" cy="520" r="330" fill="%s" opacity=".35" filter="url(#gl)"/><circle cx="512" cy="536"' % glow, 1)
        a = a.replace('</defs>', '<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter></defs>')
    open(name + '.svg', 'w').write(a)

NAVY  = [(0,"2a3d52"),(.14,"1c2c3e"),(.3,"132233"),(.45,"070d16"),(.55,"0a1420"),(.75,"0d1b2c"),(1,"12263c")]
MID   = [(0,"1f3f66"),(.14,"16345a"),(.3,"0e2747"),(.45,"040b18"),(.55,"071429"),(.75,"0b2140"),(1,"0f2c55")]   # deeper, bluer
INK   = [(0,"30343a"),(.14,"212429"),(.3,"16181c"),(.45,"060708"),(.55,"0b0c0e"),(1,"15171b")]                  # near-black
PURP  = [(0,"3b3060"),(.14,"2a2250"),(.3,"1c173a"),(.45,"09071a"),(.55,"110d26"),(.75,"1b1640"),(1,"231d52")]   # twilight
TEAL  = [(0,"1f4a55"),(.14,"163a45"),(.3,"0f2a33"),(.45,"040f14"),(.55,"07181f"),(.75,"0c2730"),(1,"10323d")]

bg(NAVY, 'b1.jpg')
bg(MID,  'b2.jpg', faint=.10, burst=.45, tint=(90,180,255))          # blue light rays
bg(INK,  'b3.jpg', faint=.05, burst=.55, tint=(40,150,255))          # black with a blue burst at the centre
bg(PURP, 'b4.jpg', faint=.08, burst=.40, tint=(170,150,255))
bg(TEAL, 'b5.jpg', faint=.08, burst=.40, tint=(120,230,255))

G = ("#3a414b", "#262b32", "#16191e"); GR = ("#5b6470", "#2a3038"); BLUE = ("#8fd4ff", "#2ea6ff")
svg('1-navy',      'b1.jpg', G, GR, BLUE)
svg('2-midnight',  'b2.jpg', ("#f2f5f8", "#dde3ea", "#b3bdc9"), ("#ffffff", "#c9d1db"), ("#5a6473", "#434c59"))  # white globe as today, night sky
svg('3-blackburst','b3.jpg', G, ("#7a8490", "#30363e"), BLUE, glow="#1e90ff")
svg('4-twilight',  'b4.jpg', ("#3c3a52", "#28263a", "#17151f"), ("#6a6680", "#2e2b3d"), ("#c9b8ff", "#8f78ff"))
svg('5-deepsea',   'b5.jpg', ("#2f4148", "#1f2d33", "#121a1e"), ("#5d7780", "#27353a"), ("#a6f0ff", "#3cc8e6"))
svg('6-chrome',    'b3.jpg', ("#e9edf2", "#aeb7c2", "#5d6672"), ("#f4f6f8", "#7d8692"), ("#1d232b", "#0d1116"), glow="#1e90ff")  # brushed-metal globe
