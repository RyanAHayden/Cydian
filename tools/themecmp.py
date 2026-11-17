#!/usr/bin/env python3
"""Compare WinterBoard theme images on the 4S with the stock images they replace, in a viewer.

Pairs: Themes/<t>/Bundles/com.saurik.Cydia/<f> -> Applications/Cydia.app/<f>, and Themes/<t>/UIImages/<n>@2x.png
-> artwork/Shared@2x/<n>.png (tools/artwork.py output). Stock Cydia PNGs are Apple's CgBI flavour (BGRA,
premultiplied, raw deflate), which browsers can't show, so they're decoded into <pull>/themecmp/stock/.

Output (gitignored): <pull>/themes.html. Needs Pillow + numpy (local tool).
Usage: tools/themecmp.py [pull_dir (ref/4s-after-respring)] [artwork_dir (ref/4s/artwork/Shared@2x)]
"""
import html
import io
import os
import struct
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def load(path):
    """Open a PNG, CgBI or not, as straight-alpha RGBA."""
    b = Path(path).read_bytes()
    if b[12:16] != b'CgBI':
        return Image.open(io.BytesIO(b)).convert('RGBA')
    out, idat, i = [b[:8]], b'', 8
    while i < len(b):
        n, t = struct.unpack('>I4s', b[i:i + 8])
        d = b[i + 8:i + 8 + n]
        i += 12 + n
        if t == b'IDAT':
            idat += d
        elif t == b'IEND':
            z = zlib.compress(zlib.decompress(idat, -15))
            out += [struct.pack('>I', len(z)), b'IDAT', z, struct.pack('>I', zlib.crc32(b'IDAT' + z))]
            out.append(b[i - 12 - n:i])
        elif t != b'CgBI':
            out.append(b[i - 12 - n:i])
    a = np.asarray(Image.open(io.BytesIO(b''.join(out))).convert('RGBA'), dtype=np.float32)[..., [2, 1, 0, 3]]
    alpha = a[..., 3:]
    a[..., :3] = np.where(alpha > 0, np.minimum(a[..., :3] * 255 / np.maximum(alpha, 1), 255), 0)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def pairs(pull, art):
    themes = next(pull.glob('var/stash/*/Themes'))
    for t in sorted(themes.iterdir()):
        for f in sorted((t / 'Bundles/com.saurik.Cydia').rglob('*.png')):
            stock = pull / 'Applications/Cydia.app' / f.relative_to(t / 'Bundles/com.saurik.Cydia')
            yield t.stem, f, stock
        for f in sorted((t / 'UIImages').glob('*@2x.png')):
            yield t.stem, f, art / f.name.replace('@2x', '')


def main(pull, art):
    out = pull / 'themecmp/stock'
    cards = []
    for theme, f, stock in pairs(pull, art):
        rel = os.path.relpath(f, pull)
        s_rel = None
        if stock.exists():
            dst = out / f'{theme}__{stock.name}'
            dst.parent.mkdir(parents=True, exist_ok=True)
            load(stock).save(dst)
            s_rel = os.path.relpath(dst, pull)
        w, h = Image.open(f).size
        scale = 2 if '@2x' in f.name else 1
        st = f'<img class=stock src="{html.escape(s_rel)}">' if s_rel else '<span class="stock none">no stock file</span>'
        cards.append((not s_rel, w * h, f'<figure><div class=img style="--w:{w / scale}px;--h:{h / scale}px">{st}'
                     f'<img class=theme src="{html.escape(rel)}"></div>'
                     f'<figcaption>{html.escape(theme)}<br>{html.escape(f.name)}</figcaption></figure>'))
    page = f'''<!doctype html><meta charset=utf-8><title>Theme compare</title>
<style>
body{{margin:0;font:13px system-ui,sans-serif;background:#c5ccd4;color:#222}}
header{{position:sticky;top:0;z-index:1;background:#fff;padding:8px 16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;box-shadow:0 1px 3px #0003}}
main{{display:flex;flex-wrap:wrap;gap:12px;padding:16px;align-items:flex-start}}
figure{{margin:0;background:#fff8;padding:8px;border-radius:6px;max-width:100%;overflow:auto}}
figcaption{{font-size:11px;margin-top:4px;word-break:break-all;max-width:240px}}
.img{{display:flex;gap:6px;zoom:var(--zoom,1)}}
.img img,.none{{width:var(--w);height:var(--h);display:none;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/8px 8px}}
.none{{font-size:8px;color:#900;overflow:hidden}}
body.m-stock .stock,body.m-theme .theme,body.m-side .stock,body.m-side .theme{{display:block}}
</style>
<header>
<label><input type=radio name=m value=stock> Stock (iOS 6)</label>
<label><input type=radio name=m value=theme> Theme</label>
<label><input type=radio name=m value=side> Side by side</label>
<label>Zoom <input id=z type=range min=1 max=6 step=.5 value=2></label>
<span>{len(cards)} themed images · keys: 1-3 modes, Space flips Stock/Theme</span>
</header>
<main>{"".join(c[2] for c in sorted(cards))}</main>  <!-- with stock first, small first -->
<script>
const set=m=>{{document.body.className='m-'+m;document.querySelector(`[value=${{m}}]`).checked=true}};
document.querySelectorAll('[name=m]').forEach(r=>r.onchange=()=>set(r.value));
onkeydown=e=>{{if(e.key>='1'&&e.key<='3')set(['stock','theme','side'][e.key-1]);if(e.key==' '){{e.preventDefault();set(document.body.className=='m-stock'?'theme':'stock')}}}};
z.oninput=()=>document.body.style.setProperty('--zoom',z.value);
set('side');z.oninput();
</script>'''
    (pull / 'themes.html').write_text(page)
    print(f'{len(cards)} themed images -> {pull / "themes.html"}')


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'ref/4s-after-respring'),
         Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'ref/4s/artwork/Shared@2x'))
