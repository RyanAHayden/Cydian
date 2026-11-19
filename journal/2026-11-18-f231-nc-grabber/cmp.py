import sys
from PIL import Image, ImageOps
ref, zoom, light, dark, out = sys.argv[1:6]
Z = 4  # zoom on top of 3x
s4 = Image.open(ref).convert("RGB").crop((266, 920, 374, 960))  # 2x
s4 = ImageOps.flip(s4).resize((s4.width * 3 // 2 * Z, s4.height * 3 // 2 * Z), Image.NEAREST)
def mine(p):
    im = Image.open(p).convert("RGB")
    c = im.crop((300 - 81, 60 - 9, 300 + 81, 60 + 51))  # grip at 3x: x 300 +-64.5, top 60
    return c.resize((c.width * Z, c.height * Z), Image.NEAREST)
zm = ImageOps.flip(Image.open(zoom).convert("RGB"))
zm = zm.resize((s4.width, int(zm.height * s4.width / zm.width)), Image.NEAREST)
tiles = [s4, mine(light), mine(dark)]
W = sum(t.width for t in tiles) + 40
H = max(t.height for t in tiles) + zm.height + 30
canvas = Image.new("RGB", (W, H), "white")
x = 0
for t in tiles:
    canvas.paste(t, (x, 0)); x += t.width + 20
canvas.paste(zm, (0, max(t.height for t in tiles) + 20))
canvas.save(out)
