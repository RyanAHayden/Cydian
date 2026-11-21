# Browser smoke test

`node tools/smoke/smoke.mjs` runs `web/app/` in headless Chromium and drives it like a finger: a push (Home >
Settings > a Settings page), Back, an edge swipe back (CDP touch events), and a sheet opened and closed with Done.
It also opens the screenshots gallery above a group of rows and checks every frame that the rows never overlap it
and move with its edge, and that a loading skeleton swapped for content leaves no fading copy (none at all mid-push).
With `--shots` the gallery step runs at a tenth of its speed and is shot every 150 ms (`6-gallery-NN.png`).
Every animation on the way is recorded (`transitionrun`, `animationstart`, `document.getAnimations()` polled each
frame, and `Element.animate`); it fails if one animates a layout property (height, width, top/left, margins,
padding, ...), if a push/pop/swipe didn't land or didn't slide, or if the page threw.

It is not in `tools/check.sh`: it needs Chromium (a run takes about 10 seconds).

    node tools/smoke/smoke.mjs                 # the jailbreak app (fake bridge: every call answers null)
    node tools/smoke/smoke.mjs --site          # the website (no edge swipe there)
    node tools/smoke/smoke.mjs other/app/dir   # another copy, e.g. a scratch worktree's web/app
    node tools/smoke/smoke.mjs --keep          # also list every animation it saw
    node tools/smoke/smoke.mjs --shots DIR     # screenshots of each step

`CHROMIUM=<path>` picks the browser (default `chromium` on PATH). Exit codes: 0 passed, 1 a check failed, 2
Chromium didn't start.
