import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
# (left, top, right, bottom) in the iPhone 15's 3x pixels: the row only, the Settings icon cut off.
boxes = {
    "1-privacy-security.jpg": (183, 362, 1158, 508),
    "2-developer-mode.jpg": (183, 384, 1158, 527),
    "3-pair-with-ifizbox.jpg": (48, 234, 1158, 380),
}
for name, box in boxes.items():
    im = Image.open(f"{src}/{name}").convert("RGB").crop(box)
    # The group's rounded corners show the black screen behind: fill them with the row's grey, so the shot is a
    # plain rectangle (the page rounds it itself). Nothing in a row is that dark.
    px = im.load()
    row = px[im.width // 2, 8]
    for y in range(im.height):
        for x in range(im.width):
            if sum(px[x, y]) < sum(row) - 2:
                px[x, y] = row
    im.save(f"{out}/{name}", "JPEG", quality=78, optimize=True, progressive=True)
    print(name, im.size)
