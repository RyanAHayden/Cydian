#!/usr/bin/env python3
"""Launch images for the home-screen web app (apple-touch-startup-image), one per current iPhone screen.

Home as it first appears while it loads: the nav bar titled with the app's name (native/brand.env; under the status bar too), the pinstripe
background with the app's own Loading spinner in the middle, and the tab bar with Home selected, so the launch screen
turns into the page without a jump. Drawn by headless Chromium from the app's real stylesheets (the ones index.html
links), with each phone's safe-area insets put in where env() would give them.

    tools/launch_images.py OUT_DIR      (writes launch-<W>x<H>.png in device pixels; index.html links them)
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

APP = pathlib.Path(__file__).resolve().parent.parent / "web" / "app"
sys.path.insert(0, str(APP.parent.parent / "native"))
from brand import NAME  # noqa: E402  (F170)

# (width pt, height pt, scale, top inset, bottom inset): the screens index.html has media queries for.
SCREENS = [
    (393, 852, 3, 59, 34), (430, 932, 3, 59, 34), (402, 874, 3, 62, 34), (440, 956, 3, 62, 34),
    (390, 844, 3, 47, 34), (428, 926, 3, 47, 34), (375, 812, 3, 44, 34), (414, 896, 2, 48, 34),
    (375, 667, 2, 20, 0),
]


TABS = ["Home", "Sources", "Changes", "Installed", "Search", "Settings"]


def page(top: int, bottom: int) -> str:
    links = re.findall(r'<link rel="stylesheet" href="([^"]+)"', (APP / "index.html").read_text())
    css = "".join((APP / href).read_text() for href in links)
    css = css.replace("env(safe-area-inset-top)", f"{top}px").replace("env(safe-area-inset-bottom)", f"{bottom}px")
    css = css.replace("env(safe-area-inset-left)", "0px").replace("env(safe-area-inset-right)", "0px")
    tabs = "".join(f'<a class="tab{" active" if t == "Home" else ""}" data-tab="{t.lower()}"><span class="tab-icon"></span>'
                   f'<span class="tab-label">{t}</span></a>' for t in TABS)
    return (f"<!doctype html><html data-theme='light'><head><meta charset=utf-8><style>{css}"
            "html,body{margin:0;overflow:hidden} .page-body{visibility:visible;display:flex;align-items:center;"
            "justify-content:center} .page-body::before{display:none} .loading-spinner{animation:none}</style></head><body>"
            "<header class='navbar'><div class='nav-stack is-active'><div class='nav-item is-top'><div></div>"
            f"<h1 class='nav-title'>{NAME}</h1><div></div></div></div></header>"
            "<div class='page-body grouped'><div class='loading'><span class='loading-spinner'></span><span>Loading</span></div></div>"
            f"<nav class='tabbar'>{tabs}</nav></body></html>")


def main(out: str) -> None:
    browser = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    if not browser:
        sys.exit("launch_images: needs chromium")
    os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for w, h, scale, top, bottom in SCREENS:
            html = pathlib.Path(tmp, f"{w}x{h}.html")
            html.write_text(page(top, bottom))
            dest = os.path.join(out, f"launch-{w * scale}x{h * scale}.png")
            subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={tmp}/u",
                            f"--window-size={w},{h}", f"--force-device-scale-factor={scale}",
                            f"--screenshot={dest}", html.as_uri()], check=True, capture_output=True, timeout=60)
    print("launch_images:", out)


if __name__ == "__main__":
    main(sys.argv[1])
