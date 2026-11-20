# T56 Launch images regenerated

The committed `web/app/icons/launch/*.png` (last regenerated 2026-11-18) no longer matched what
`tools/launch_images.py` draws.

## What I did

- Ran `tools/launch_images.py` twice into scratch folders, not the whole `tools/icons.sh`, because the task is
  only the launch images and icons.sh also rewrites the app icons. Both runs came out byte-identical, so the
  script is deterministic.
- Diffed each new image against the committed one (Pillow): the only changed area is the status-bar strip at the
  top (rows 0-176 on 1179x2556, rows 0-39 on 750x1334, the full width). Nothing below the strip changed: nav bar,
  pinstripes, spinner and tab bar are pixel-identical.
- In the strip, the old images continued the nav bar's blue (e.g. rgb(79,105,139)). The new ones are plain black.
- Cause: B132 (2026-11-20, `web/app/ios6.css`) made the strip continue the nav bar only in the app shell
  (`html[data-shell="app"]`) and plain black on the web. Launch images are the web app's
  `apple-touch-startup-image`, and index.html sets `apple-mobile-web-app-status-bar-style=black`, so iOS draws a
  black status bar there. Black is right: the old blue strip would flash blue, then black, at launch.
- So it's a real change, not drift. Committed the new images.

## Not verified

- Not seen on a phone launching the Home Screen web app: no iOS device step in an unattended run, and iOS reads
  startup images only when the icon is added again.
