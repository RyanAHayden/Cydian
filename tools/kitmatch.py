#!/usr/bin/env python3
"""Find each 4S UIKit image (tools/artwork.py output) in the Teehan+Lax iOS 6 kit and cut out its HD counterpart.

The kit draws most controls as vectors, so matching is against the whole sheet, not single layers:
1. Locate: masked normalised cross-correlation (FFT, grey, device alpha as the mask) of the device image over
   `original-2x.png` (Photoshop's composite, 2x like the device).
2. Score: blend the device image over the kit pixels it landed on and take the mean absolute RGB difference
   (0-255). Low = same artwork. NCC alone can't tell a blue button from a grey one; this can.
3. Cut: the same rectangle from `original-2x.png` (Kit 2x) and from `render-4x.png` (sheet-hd.svg rendered at
   2x: vectors redrawn crisp, bitmaps from img-hd/). The HD cut is the asset we use; the device file stays
   as the "original" to compare against.

Output (gitignored, Apple-derived): ref/4s/hd/<Name>.png (HD, 4x points), ref/4s/kit2x/<Name>.png,
ref/4s/kitmatch.json and ref/4s/kitmatch.html (viewer: HD / Original / Kit 2x / side by side / diff).
Needs Pillow + numpy (local tool, not part of the site). Render the HD sheet first:
  chromium --headless --hide-scrollbars --force-device-scale-factor=2 --window-size=3000,3000 \
    --screenshot=ref/teehanlax/ios6/render-4x.png file://$PWD/ref/teehanlax/ios6/sheet-hd.svg
(Not rsvg-convert: it ignores `transform-origin` on gradients, so every button loses its gloss.)
Transparent device images get their own alpha, scaled 2x, on the HD cut, so the cut is the asset alone and not
the mockup behind it. The alpha edge is then 2x-soft; the colour inside it is the crisp HD render.
Usage: tools/kitmatch.py [artwork_dir]
"""
import html
import json
import multiprocessing as mp
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT / 'ref/teehanlax/ios6'
OUT = ROOT / 'ref/4s'
MIN_OPAQUE = 48   # opaque pixels needed to locate an image at all
MAX_DIFF = 12     # ponytail: hand-picked from the viewer (real matches sat at 0-12); tune with its slider
MIN_NCC = 0.85    # below this, low diff means "mostly transparent", not "same shape"

Image.MAX_IMAGE_PIXELS = None
SHEET = np.asarray(Image.open(KIT / 'original-2x.png').convert('RGB'), dtype=np.float64)
GREY = SHEET @ [0.299, 0.587, 0.114]
H, W = GREY.shape
F1, F2 = np.fft.rfft2(GREY), np.fft.rfft2(GREY ** 2)


def corr(fk, k):
    """Correlation of the sheet (given as its FFT fk) with small kernel k, for every top-left offset."""
    return np.fft.irfft2(fk * np.conj(np.fft.rfft2(k, (H, W))), (H, W))


def locate(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    a = np.asarray(im, dtype=np.float64)
    mask = (a[..., 3] > 128).astype(np.float64)
    n = mask.sum()
    if n < MIN_OPAQUE or w > W or h > H:
        return None
    t = (a[..., :3] @ [0.299, 0.587, 0.114]) * mask
    st, stt = t.sum(), (t * t).sum()
    var_t = stt - st * st / n
    if var_t < n:  # flat colour (std < 1): matches anywhere, can't be located
        return None
    sf, sff, stf = corr(F1, mask), corr(F2, mask), corr(F1, t)
    var_f = np.maximum(sff - sf * sf / n, n)  # floor kills flat sheet areas dividing by ~0
    ncc = (stf - st * sf / n) / np.sqrt(var_t * var_f)
    ncc = ncc[:H - h + 1, :W - w + 1]
    y, x = np.unravel_index(np.argmax(ncc), ncc.shape)
    under = SHEET[y:y + h, x:x + w]
    al = a[..., 3:] / 255
    diff = np.abs(a[..., :3] * al + under * (1 - al) - under).sum(axis=2)
    diff = float((diff * al[..., 0]).sum() / max(al.sum(), 1) / 3)
    return {'device': path.name, 'x': int(x), 'y': int(y), 'w': w, 'h': h,
            'ncc': round(float(ncc[y, x]), 3), 'diff': round(diff, 1)}


def viewer(rows, art_rel):
    cards = '\n'.join(
        f'<figure data-diff="{r["diff"]}" data-ncc="{r["ncc"]}"><div class=img style="--w:{r["w"] / 2}px;--h:{r["h"] / 2}px">'
        f'<img class=orig src="{art_rel}/{html.escape(r["device"])}">'
        f'<img class=hd src="hd/{html.escape(r["device"])}">'
        f'<img class=kit src="kit2x/{html.escape(r["device"])}"></div>'
        f'<figcaption>{html.escape(r["device"])}<br>{r["w"] // 2}×{r["h"] // 2} pt at ({r["x"]},{r["y"]}) · '
        f'diff {r["diff"]} · ncc {r["ncc"]}</figcaption></figure>'
        for r in sorted(rows, key=lambda r: r['diff']))
    return f'''<!doctype html><meta charset=utf-8><title>Kit match</title>
<style>
body{{margin:0;font:13px system-ui,sans-serif;background:#c5ccd4;color:#222}}
header{{position:sticky;top:0;z-index:1;background:#fff;padding:8px 16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;box-shadow:0 1px 3px #0003}}
main{{display:flex;flex-wrap:wrap;gap:12px;padding:16px;align-items:flex-start}}
figure{{margin:0;background:#fff8;padding:8px;border-radius:6px;max-width:100%;overflow:auto}}
figcaption{{font-size:11px;margin-top:4px;word-break:break-all;max-width:320px}}
.img{{display:flex;gap:6px;zoom:var(--zoom,1)}}
.img img{{width:var(--w);height:var(--h);display:none;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/8px 8px}}
body.m-hd .hd,body.m-orig .orig,body.m-kit .kit,body.m-side .orig,body.m-side .hd,body.m-diff .orig,body.m-diff .hd{{display:block}}
body.m-diff .img{{display:grid}}body.m-diff .img img{{grid-area:1/1}}body.m-diff .hd{{mix-blend-mode:difference;background:none}}
</style>
<header>
<label><input type=radio name=m value=hd> HD (kit, upscaled)</label>
<label><input type=radio name=m value=orig> Original (4S)</label>
<label><input type=radio name=m value=kit> Kit 2x</label>
<label><input type=radio name=m value=side> Side by side</label>
<label><input type=radio name=m value=diff> Diff</label>
<label>Zoom <input id=z type=range min=1 max=8 step=.5 value=2></label>
<label>Max diff <input id=s type=range min=0 max=60 value={MAX_DIFF}> <span id=sv></span></label>
<label><input type=checkbox id=lo> show NCC &lt; {MIN_NCC}</label> <span id=n></span><span>keys: 1-5 modes, Space flips HD/Original</span>
</header>
<main>{cards}</main>
<script>
const set=m=>{{document.body.className='m-'+m;document.querySelector(`[value=${{m}}]`).checked=true}};
document.querySelectorAll('[name=m]').forEach(r=>r.onchange=()=>set(r.value));
const modes=['hd','orig','kit','side','diff'];
onkeydown=e=>{{if(e.key>='1'&&e.key<='5')set(modes[e.key-1]);if(e.key==' '){{e.preventDefault();set(document.body.className=='m-hd'?'orig':'hd')}}}};
z.oninput=()=>document.body.style.setProperty('--zoom',z.value);
s.oninput=()=>{{sv.textContent=s.value;let k=0;document.querySelectorAll('figure').forEach(f=>k+=!(f.hidden=+f.dataset.diff>+s.value||!lo.checked&&+f.dataset.ncc<{MIN_NCC}));n.textContent=k+' shown'}};
lo.onchange=s.oninput;set('side');z.oninput();s.oninput();
</script>'''


if __name__ == '__main__':
    art = Path(sys.argv[1] if len(sys.argv) > 1 else OUT / 'artwork/Shared@2x')
    paths = sorted(p for p in art.glob('*.png') if not p.stem.endswith('Mask'))  # masks are alpha shapes, not art
    with mp.Pool(8) as pool:  # ~0.5 GB of FFT temporaries per worker
        found = [r for r in pool.map(locate, paths, chunksize=4) if r]
    (OUT / 'kitmatch.json').write_text(json.dumps(found, indent=1))  # every find, good or bad, for tuning
    hd = Image.open(KIT / 'render-4x.png')
    kit = Image.open(KIT / 'original-2x.png')
    for d in ('hd', 'kit2x'):
        (OUT / d).mkdir(exist_ok=True)
    rows = [r for r in found if r['diff'] <= 60]  # the viewer's slider tops out at 60
    for r in rows:
        x, y, w, h = r['x'], r['y'], r['w'], r['h']
        kit.crop((x, y, x + w, y + h)).save(OUT / 'kit2x' / r['device'])
        cut = hd.crop((2 * x, 2 * y, 2 * (x + w), 2 * (y + h))).convert('RGBA')
        alpha = Image.open(art / r['device']).convert('RGBA').getchannel('A')
        if alpha.getextrema()[0] < 255:
            cut.putalpha(alpha.resize(cut.size, Image.LANCZOS))
        cut.save(OUT / 'hd' / r['device'])
    (OUT / 'kitmatch.html').write_text(viewer(rows, art.resolve().relative_to(OUT.resolve()).as_posix()))
    good = sum(r['diff'] <= MAX_DIFF and r['ncc'] >= MIN_NCC for r in found)
    print(f'{len(paths)} images, {len(found)} located, {good} good (diff <= {MAX_DIFF}, ncc >= {MIN_NCC})'
          f' -> {OUT / "kitmatch.html"}')
