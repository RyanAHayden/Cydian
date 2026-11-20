import sys
from pathlib import Path
from PIL import Image

repo = Path(sys.argv[1])
out = repo / "web/app/img/why"
out.mkdir(parents=True, exist_ok=True)
doc = repo / "docs/img"
stills = repo / "journal/2026-11-20-f290-showcase-video/stills"
f288 = repo / "journal/2026-11-20-f288-tweak-injection/sheet-tweaks.png"

# framed README shots: 588x1254, the screen below the status bar is about x 54..534, y 103..1036
FRAMED = (55, 103, 533, 1034)
jobs = [
    ("tweaks", f288, (0, 830, 1170, 1720)),
    ("builds", doc / "crop-web-lite.png", None),
    ("look", doc / "web-app.png", FRAMED),
    ("routes", stills / "t20.90.jpg", (292, 362, 790, 684)),
    ("sources", doc / "jb-sources.png", FRAMED),
    ("resign", stills / "t24.40.jpg", (294, 362, 778, 920)),
    ("manage", doc / "web-installed-manage.png", FRAMED),
]
for name, src, box in jobs:
    im = Image.open(src)
    if im.mode == "RGBA":
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        im = bg
    im = im.convert("RGB")
    if box:
        im = im.crop(box)
    if im.width > 600:
        im = im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS)
    im.save(out / f"{name}.jpg", quality=84, optimize=True, progressive=True)
    print(name, im.size, (out / f"{name}.jpg").stat().st_size)
