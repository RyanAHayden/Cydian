#!/usr/bin/env python3
"""Cydian's icon background: a soft starburst, made the way the old iOS icons made theirs.

Not hand-drawn rays (those come out sharp): random noise along the angle, blurred into soft streaks, wrapped around
the centre (Photoshop's noise + motion blur + Polar Coordinates), then coloured with a top-to-bottom gradient that has
the iOS 6 shine built in: pale at the top, a dark band just below the middle, warmer toward the bottom. The colours
were measured from the original Cydia icon, used as a reference only. Every pixel here is generated.

    tools/icon_bg.py OUT.jpg      (1024x1024 JPEG; tools/icons.sh embeds it in web/app/icons/icon.svg)
"""
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d

SIZE = 1024
CX, CY = 512, 540           # rays fan out from just below the middle, behind the ring
SEED = 20261117

# (position 0-1 down the icon, colour): pale shine at the top, dark band at ~0.46, warm brown at the bottom
STOPS = [(0.0, "e9c6bb"), (.08, "d1aea2"), (.14, "c1a196"), (.2, "a8867a"), (.27, "967569"), (.33, "7b5a4f"),
         (.39, "6a483c"), (.42, "57372b"), (.45, "411f11"), (.48, "38170c"), (.55, "422113"), (.61, "512b1c"),
         (.67, "593324"), (.73, "663c2c"), (.8, "6d4030"), (.86, "7f4d3d"), (.92, "8e5b4a"), (1.0, "946252")]


def gradient():
    pos = np.array([p for p, _ in STOPS])
    rgb = np.array([[int(c[i:i + 2], 16) for i in (0, 2, 4)] for _, c in STOPS], float)
    y = np.linspace(0, 1, SIZE)
    col = np.stack([np.interp(y, pos, rgb[:, k]) for k in range(3)], -1)  # SIZE x 3
    return np.repeat(col[:, None, :], SIZE, 1)


def rays():
    """Ray strength per pixel, 0..1: blurred angular noise, a little finer noise on top, wrapped around the centre."""
    rng = np.random.default_rng(SEED)
    n = 4096  # samples around the circle
    coarse = gaussian_filter1d(rng.random(n), 7, mode="wrap")
    fine = gaussian_filter1d(rng.random(n), 2.2, mode="wrap")
    streak = 0.7 * coarse + 0.3 * fine
    streak = (streak - streak.min()) / (streak.max() - streak.min())
    streak = streak ** 2.2  # mostly dark with brighter rays, as the original
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    ang = (np.arctan2(yy - CY, xx - CX) + np.pi) / (2 * np.pi)  # 0..1
    return streak[(ang * n).astype(int) % n], np.hypot(xx - CX, yy - CY), yy / SIZE


def main(out):
    base = gradient()
    ray, r, y = rays()
    # Rays show faintly in the shine at the top and strongly in the lower half; a bright burst near the ring.
    reach = np.clip((y - 0.42) / 0.12, 0, 1) * 0.75 + 0.25
    burst = np.exp(-((r / 360.0) ** 2)) * 1.1
    lift = ray * (0.16 * reach + 0.55 * burst)
    img = base + (255 - base) * lift[..., None]
    vignette = 1 - 0.14 * np.clip((r - 430) / 320, 0, 1)
    img = np.clip(img * vignette[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(img, "RGB").save(out, quality=90, optimize=True)  # JPEG: the soft noise survives, 1/7 the size
    print("icon_bg:", out)


if __name__ == "__main__":
    main(sys.argv[1])
