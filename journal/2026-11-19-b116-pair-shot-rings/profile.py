import sys
from PIL import Image
f=sys.argv[1]; x=int(sys.argv[2])
im=Image.open(f).convert("RGB"); w,h=im.size
prev=None
for y in range(h):
    v=sum(im.getpixel((x,y)))//3
    if prev is None or abs(v-prev)>4: print(y,v)
    prev=v
