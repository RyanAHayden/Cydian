# C52 Floating tab bar era hook

## What

- `web/app/nav/tabbar.js`: `setFloatingTabbar(on)` / `floatingTabbarOn()` flip `<html data-tabbar="float">` (the
  same pattern as C54's `setLargeTitles`); `FLOAT_OWN_TAB = "search"` names the tab that becomes its own circle.
  No markup change: the hook is all CSS, so iOS 6 builds the same DOM.
- `web/app/style.css` (Era hooks): new hooks `--tabbar-float-h` 62px, `--tabbar-float-pad` 4px,
  `--tabbar-float-inset` 21px, `--tabbar-float-gap` 10px, `--tabbar-float-bottom` max(12px, safe bottom − 13px);
  rules only under `html[data-tabbar="float"]`:
  - `--tab-h` = pill height + bottom gap, so `.page-body` / `.page-body.grouped` / search results end room
    (`calc(var(--tab-h) + 20px)`) and the bars sitting on `bottom: var(--tab-h)` (reload, undo, Filter, Theme
    preview, section index) follow without touching them. The scrollers still fill the screen, so content scrolls
    under the pill.
  - `.tabbar` inset left/right/bottom, its right edge leaving room for the circle and the gap.
  - `.tab[data-tab="search"]` absolute, out of the flex row, square as tall as the pill, to the pill's right.
- `web/app/nav/tabbar.test.js`: on/off of the attribute; the CSS reads its float hooks only behind the attribute,
  iOS 6's `--tab-h` and edge-to-edge `.tabbar` unchanged; float `--tab-h` formula and the scrollers' end room read
  it; the circle rule's selector matches `FLOAT_OWN_TAB` and that tab is in `BAR_TABS`.
- `docs/eras.md`: the nav hook described (it said "not built yet"), dropped from "Not yet clean".

Values (62/21/10, bottom = safe − 13) are approximations of iOS 26's bar from memory, not measured off a device;
they are hooks, so the iOS 26 era (F203) sets its own if they're off.

## Checks

- `node --test nav/tabbar.test.js ios6-css.test.js nav/navbar.test.js search-root-css.test.js`: 41 pass.
- 3x shots + computed-style diff against main (`journal/2026-11-20-c44-era-readiness/shots.mjs`, `diff.py`, all
  themes, app shell and site): every shot `0 px, 0 style differences`, "same".
- Same shots with `data-tabbar="float"` added to a scratch copy's `<html>`: `float-geometry.png` (site, Settings,
  Classic, 1x): pill inset from the sides and bottom, Search to its right. Paint is iOS 6's (square, dark bar,
  no circle ground), as expected: rounding and glass are the era's look.
- `tools/smoke/smoke.mjs` (app), `--site`, and `--site` on the float copy: all passed.

## Not verified

- On a phone: the hook is web-only (the app's tab bar is native and `html.native` hides ours), and no era turns
  it on yet, so there is nothing to see on a device until F203 uses it.
- iOS 26's real pill dimensions: not measured (no iOS 26 reference shot in `ref/`); the values are hooks.
- A safe-area bottom inset > 0 in the float render: headless Chromium has none, so only the 12px floor was drawn.
