#!/usr/bin/env python3
"""Extract iOS 6 UIKit .artwork files to PNGs (reference only: the output is Apple artwork, keep it in ref/).

Layout (little-endian): u32 count, u32 records_offset, u32 name_offset[count]; at records_offset, count records
of {u32 flags, u16 width, u16 height, u32 data_offset}; names are NUL-terminated; pixel data is premultiplied
BGRA (flags 0/1) or 8-bit grey (flags 2); stride is the gap to the next image divided by height.

Usage: tools/artwork.py FILE.artwork OUTDIR
"""
import struct
import sys
import zlib
from pathlib import Path


def read(path):
    b = Path(path).read_bytes()
    count, rec = struct.unpack_from('<II', b)
    names = [b[o:b.index(b'\0', o)].decode() for o in struct.unpack_from(f'<{count}I', b, 8)]
    recs = [struct.unpack_from('<IHHI', b, rec + 12 * i) for i in range(count)]
    ends = sorted({r[3] for r in recs} | {len(b)})
    for name, (flags, w, h, off) in zip(names, recs):
        end = ends[ends.index(off) + 1]
        stride = (end - off) // h if h else 0
        if flags == 2:  # 8-bit grey, opaque, rows padded to 4 bytes
            yield name, w, h, [bytes(v for g in b[off + y * stride: off + y * stride + w] for v in (g, g, g, 255))
                               for y in range(h)]
            continue
        if stride < w * 4:  # ponytail: only BGRA and grey seen in iOS 6.1; anything else gets skipped loudly
            print(f'skip {name}: flags {flags} {w}x{h} stride {stride}', file=sys.stderr)
            continue
        rows = []
        for y in range(h):
            row = bytearray(b[off + y * stride: off + y * stride + w * 4])
            for x in range(0, len(row), 4):  # BGRA premultiplied -> RGBA straight
                B, G, R, A = row[x:x + 4]
                if A and A < 255:
                    B, G, R = (min(255, c * 255 // A) for c in (B, G, R))
                row[x:x + 4] = bytes((R, G, B, A))
            rows.append(bytes(row))
        yield name, w, h, rows


def png(w, h, rows):
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    raw = b''.join(b'\0' + r for r in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    src, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for name, w, h, rows in read(src):
        (out / name).write_bytes(png(w, h, rows))
        n += 1
    print(f'{n} images -> {out}')
