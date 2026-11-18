#!/usr/bin/env python3
"""The native app's launch screen image (N10): one plain fill in the pinstripes' light colour (web/app/ios6.css
--pin-light), 1800x3600 px at @2x and @3x. iOS draws a UILaunchScreen image centred at its own size, so a fill bigger
than any iPhone covers every screen, whatever its size; bars or a title would only line up on screens whose size is
known (they came out cut off and offset on newer iPhones). The page's own loading screen (index.html #boot: the
bars, pinstripes and Loading) follows a moment later. Stdlib only.

    native/launch/make.py [OUT_DIR]   (default: native/launch/)
"""
import pathlib
import struct
import sys
import zlib

HERE = pathlib.Path(__file__).resolve().parent
COLOUR = (0xCE, 0xD3, 0xDC)
W, H = 1800, 3600


def png(w, h, rgb):
    raw = (b"\x00" + bytes(rgb) * w) * h
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)  # noqa: E731
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main(out=HERE):
    out = pathlib.Path(out)
    for scale in ("@2x", "@3x"):
        (out / f"LaunchLoading{scale}.png").write_bytes(png(W, H, COLOUR))
    print("launch:", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else HERE)
