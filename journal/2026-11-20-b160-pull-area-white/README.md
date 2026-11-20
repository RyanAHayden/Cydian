# B160: pull to refresh area one colour, the list's own

User screenshots (sideload app, Sources): while pulling, the revealed space was white, then turned grey-blue once
the arrow and "Release to refresh… / Last Updated" showed.

## Cause

The pull area (`.pull-refresh`, nav/pullrefresh.js) had its own colour, `#e2e7ed` (dark: `--dk-field`). The area's
box (`.pull-clip`) is `visibility: hidden` until the script switches it on, and on iOS the first frames of the
rubber band (and every frame before `ensure()` places it) show the scroller's own background, the list's white.
So a pull started white and jumped to blue-grey when the area appeared.

## Fix

- `web/app/ios6.css`: `.pull-refresh` background is `var(--plain)`, the list's background token: `#fff` in light
  (Sepia/Solarized: their own `--plain`), each dark theme's list colour in dark. The dark rule keeps only the text
  colour. The comment block says why. Whether the area is shown or not, the gap is the same colour.
- `pullrefresh.test.js`: a test pins `.pull-refresh` to `var(--plain)` and no other pull rule to a background.
- No JS change needed: nothing in pullrefresh.js sets a colour. palettes.css untouched: every palette already
  defines `--plain`.

## Check

`capture.mjs` (B129's fake-bridge shell, sideload mode, here at 390x844 DPR 3 with 47/34 safe areas, plus a
`touch` step that drives `Input.dispatchTouchEvent`), `script.json`. Held pulls, computed area colour read in the
page while held:

| page / theme | under the trigger | past the trigger |
|---|---|---|
| Sources, light | rgb(255,255,255) | rgb(255,255,255) |
| Changes, light | | rgb(255,255,255) |
| Home, light | | rgb(255,255,255) |
| Sources, Gunmetal | rgb(37,39,43) = its `--plain` | rgb(37,39,43) |

`pulls.png`: the six shots side by side (top 400 pt of each). The revealed space, arrow and text sit on one colour.

Tried: a Dracula pull at the end of the same run showed no area: the Gunmetal release before it had started a
refresh, and a pull while one runs does nothing by design. Not retried; Dracula uses the same `--plain` token.

## Not verified

- On the phone (native rubber band, where the white frames actually came from): no phone driving in this task;
  Chromium uses the script-mode pull. The fix removes the second colour, so there is nothing left to flash to.
- Home in light is a grouped (pinstripe) page: the pull area there is now white over pinstripes, as the brief asks
  ("white on every page"). Seen in the shot; not asked about further.
- Dracula/Midnight/Linen/Nord/OLED dark pulls not shot (same token as Gunmetal).
