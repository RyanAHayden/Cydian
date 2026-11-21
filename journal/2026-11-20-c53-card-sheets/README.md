# C53: era hook for card sheets

## What was done

- `web/app/nav/sheet.js`: the card hook. With `<html data-sheet="card">` every `showSheet` (so every modal sheet in
  the app) also pushes the page behind back: `#navbar`, `#screens` and `#tabbar` each animate (Web Animations,
  `fill: forwards`, 350 ms in / 300 ms out on the iOS 6 curve) to `translate(…) scale(s)` plus `opacity`. The
  translate makes each fixed piece scale about the screen's centre rather than its own. The numbers come from
  `--sheet-behind-scale` / `-shift` / `-opacity` on `<html>` (defaults 0.92 / 0 / 0.75). A sheet over a sheet leaves
  the page where it is; the last card sheet to close brings it back and then cancels the animations, so no inline
  state is left. The return starts from the page's computed transform and opacity, so a sheet closed before the
  push-back ends doesn't jump. Off (iOS 6), the code paths are skipped and nothing else animates. The black ground it
  dims onto is `ios6.css`'s `body { background: #000 }`, the only body background in any stylesheet.
- `web/app/packages.css`, the sheet rules: hooks `--sheet-top` (the sheet's top inset, iOS 6 `0px`) and
  `--sheet-bar-top` (the status bar's room in its bar, iOS 6 `env(safe-area-inset-top)`). The bar's height is now
  `calc(44px + var(--sheet-bar-top))`, the same as `--nav-h` in iOS 6. `html[data-sheet="card"]` sets the card
  values: gap = safe top + 10px, bar top 0, `overflow: hidden` so the corners clip, and the behind numbers. In the
  look-only stretch: `--sheet-radius` (0px / 10px) on the top corners. `ios6-css.test.js` still passes, since the
  stretch only gained paint and custom properties.
- `docs/eras.md`: the nav hooks list says card sheets exist and gives their hooks table.
- `sheet.test.js`: three tests. Hook off: only the sheet animates. Hook on: the three pieces get the
  right transform and opacity, frames hold transform/opacity only, a second sheet doesn't push again, the last close
  animates back and cancels all six animations. Defaults apply when no custom properties are set. A fourth
  test (added after review): closing mid push-back starts the return from the computed state.

Who sets `data-sheet="card"`: the era, from JS, when it is chosen. Nothing in the app sets it today, so the hook is
off everywhere.

## Checks

- `node --test web/app/nav/sheet.test.js web/app/ios6-css.test.js web/app/palettes.test.js`: 27 pass (sheet.test.js
  10 after the review fix).
- `tools/check.sh`: run by `run done`, which refuses to tick unless it passes.

## Spec review

A fresh subagent saw only the diff and the brief. Fixed: closing mid push-back made the page jump to the end before
coming back. Reverted: the exported `cardSheets()`, which nobody asked for. Kept: `--sheet-radius`, since the rounded
corners are what makes the sheet a card. Checked: the black ground is real (`ios6.css` body). Everything else it
raised is already listed under Not verified.
- 3x screenshot + computed-style diff against main with C46's harness
  (`journal/2026-11-20-c46-packages-era-readiness/shots.mjs`, which includes a modal sheet over Settings in every
  theme), compared with C44's `diff.py`: **same**, all 68 shots, 0 px and 0 computed-style differences. iOS 6 is
  unchanged.
- `tools/smoke/smoke.mjs` (app and `--site`): passed, sheet step included, "no layout property animated".
- Card on: `card-shots.mjs` (this folder) sets the attribute at DOMContentLoaded. Shots are in `shots/` (1x). The
  `*+sheet` shots show the 10px gap and the rounded corners (headless Chromium's safe top is 0). The `*+notch` shots
  fake a notch's 57px gap through `--sheet-top` and show the Settings page scaled back and dimmed, peeking above the
  card.

## Tried and failed

- Setting `data-sheet` from `Page.addScriptToEvaluateOnNewDocument` directly: `<html>` doesn't exist yet at that point,
  so the attribute never landed. It is set at DOMContentLoaded instead.
- `card-shots.mjs` hung after its last shot in one run (exit 124 from `timeout`). Every shot had already been written.
  The harness's teardown sometimes doesn't exit; that doesn't affect the shots.

## Not verified

- Card mode on a real phone (iOS 13+ WebKit, real safe areas): no era sets the attribute yet, and the phones'
  builds come from main. Headless Chromium with a faked gap only.
- The close path in a real browser (page animating back, animations cancelled): only covered by the unit test's
  fake DOM. The card shots catch the open state only.
- The page behind has square corners when scaled (iOS 13 rounds it too). Rounding it would need a wrapper with
  overflow clipping around three fixed siblings, so it is left for the era to decide.
- Overlays appended to body after the page (HUD, banners, action sheets opened under a sheet) don't scale with the
  page; only `#navbar`, `#screens` and `#tabbar` do.
