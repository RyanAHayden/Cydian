# B4: short-page rubber band stretched the first group

## Finding
The rule B4 names (`.page-body > :first-child { min-height: calc(100% + 1px) }`, dca99b5) is already gone from main:
392af5e (merged after F26, where B4 was found) replaced it with one spacer for every page, in `web/app/ios6.css`:
`.page-body::before { float: left; width: 1px; margin-right: -1px; height: calc(100% + 1px) }`. It's a zero-width
float, so no element changes size, and a short page is still 1px taller than its scroller, so it still bounces. That is
the "fix in one place" the task asked for, so I didn't change ios6.css or app.js.

## What I did
- Checked it in headless Chromium 155 (390x844 @3x, CDP, `drive.mjs`/`cdp.mjs` from the F5 journal) against
  `web/app.py` with real network. Script: `b4.js`; shots in `shots/`.
  - Settings root: groups are 269 / 117 / 99 px plus the push section 156 px. All of them show; none is stretched.
    scrollHeight 901 > 844.
  - Package page (WinterBoard, rootful BigBoss): the head group is 86 px and everything follows it (Author,
    description, Depiction, Details, Depends…).
  - Home (short page): scrollHeight 845 against clientHeight 844, so the rubber band still works.
- Added `web/app/ios6-css.test.js` (runs in the gate's `node --test web/app`). It fails if any `.page-body > …` rule
  sets a height or min-height in % of the scroller, and checks that the float spacer is still there.

## Tried and failed
- I first started Flask with the system python3, which has no flask. The gate's `.venv/bin/python` works.

## Not verified
- On a real iPhone (iOS Safari or the native WKWebView): the bounce on short pages and the group layout. Only Chromium
  was checked. The 4S runs iOS 6 and can't run this app, and this task doesn't ask for the device.
