import sys
from PIL import Image, ImageChops
for n in ["confirm","review","progress","sign"]:
    for s in ["", "-mid"]:
        a=Image.open(f"shots/before/{n}{s}.png").convert("RGB"); b=Image.open(f"shots/after/{n}{s}.png").convert("RGB")
        d=ImageChops.difference(a,b); bb=d.getbbox()
        n_px=sum(1 for p in d.getdata() if p!=(0,0,0))
        print(n+s, a.size, "identical" if not bb else f"differs bbox={bb} pixels={n_px}")
