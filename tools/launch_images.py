#!/usr/bin/env python3
"""Launch images for the home-screen web app (apple-touch-startup-image), one per current iPhone screen.

Like Cydia's own Default.png: the app's frame with nothing in it. The blue nav bar (under the status bar too), the
pinstripe background and the black tab bar, no title, no icons. Drawn by headless Chromium from the app's real
style.css and ios6.css, with each phone's safe-area insets put in where env() would give them.

    tools/launch_images.py OUT_DIR      (writes launch-<W>x<H>.png in device pixels; index.html links them)
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

APP = pathlib.Path(__file__).resolve().parent.parent / "web" / "app"

# (width pt, height pt, scale, top inset, bottom inset): the screens index.html has media queries for.
SCREENS = [
    (393, 852, 3, 59, 34), (430, 932, 3, 59, 34), (402, 874, 3, 62, 34), (440, 956, 3, 62, 34),
    (390, 844, 3, 47, 34), (428, 926, 3, 47, 34), (375, 812, 3, 44, 34), (414, 896, 2, 48, 34),
    (375, 667, 2, 20, 0),
]


def page(top: int, bottom: int) -> str:
    css = (APP / "style.css").read_text() + (APP / "ios6.css").read_text()
    css = css.replace("env(safe-area-inset-top)", f"{top}px").replace("env(safe-area-inset-bottom)", f"{bottom}px")
    css = css.replace("env(safe-area-inset-left)", "0px").replace("env(safe-area-inset-right)", "0px")
    return (f"<!doctype html><html data-theme='light'><head><meta charset=utf-8><style>{css}"
            "html,body{margin:0;overflow:hidden} .page-body{visibility:visible}</style></head><body>"
            "<header class='navbar'></header><div class='page-body grouped'></div><nav class='tabbar'></nav>"
            "</body></html>")


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
