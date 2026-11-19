import sys
from PIL import Image
f=sys.argv[1]
im=Image.open(f).convert("RGB"); w,h=im.size
for y in map(int,sys.argv[2:]):
    xs=[x for x in range(w) if sum(im.getpixel((x,y)))//3>15]
    print(y, "lit from", xs[0], "to", xs[-1])
