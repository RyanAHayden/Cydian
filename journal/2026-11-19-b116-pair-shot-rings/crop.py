"""python3 crop.py <ref/pair-shots> <web/app/img/pair>

Crops the user's Settings screenshots (iPhone 15, 3x, 1206 px wide) to the row to tap and its neighbours, and prints
each row's box as percentages of the cropped image for core/installroute.js PAIR_GUIDE.

Row bounds were measured on the originals (profile.py / hprofile.py in this folder): the inset group spans x 48..1158;
a row runs from the middle of the separator above it (3 px lines) or the group's top edge, to the middle of the
separator below it or the group's bottom edge.
"""
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
SHOTS = {
    # name: (crop top, crop bottom), row (left, top, right, bottom), in the original's pixels
    "1-privacy-security.jpg": ((36, 545), (48, 360.5, 1158, 509)),   # Face ID, SOS, Privacy: last row of its group
    "2-developer-mode.jpg": ((72, 674), (48, 383, 1158, 528.5)),     # Apple Intelligence, Security header, Developer Mode, Wired
    "3-pair-with-ifizbox.jpg": ((110, 430), (48, 234, 1158, 381)),   # Other Devices header, the Pair pill
}
for name, ((top, bottom), (l, t, r, b)) in SHOTS.items():
    im = Image.open(f"{src}/{name}").convert("RGB")
    im = im.crop((0, top, im.width, bottom))
    im.save(f"{out}/{name}", "JPEG", quality=78, optimize=True, progressive=True)
    w, h = im.size
    pct = lambda v, n: round(v / n * 100, 2)
    box = {"x": pct(l, w), "y": pct(t - top, h), "w": pct(r - l, w), "h": pct(b - t, h)}
    print(name, im.size, box)
