# B239: Theme > Style swaps Home's icons without a reload

Two things were read once, at import, for the style showing at start-up:

- `home.js` `SETTINGS_ICON = rowIcon(PAGE_ICONS.general)`: Home's Settings gear.
- `why.js` `WHY_CSS = whyCss()` (always iOS 6), and `ensureWhyStyle()` wrote the `<style id="why-style">` once and
  never again, so the Why tile kept the start-up style's star.

What changed:

- `home.js`: `settingsIcon(style)` replaces `SETTINGS_ICON`; `homeLinks()` calls it, so each draw takes the
  style showing then. Home already drawn stays on screen across a switch (Settings > Theme is on Home's stack), so
  `followStyle(box, onStyle)` watches `<html data-style>` (a MutationObserver, stopped once Home leaves the page) and
  Home's root calls `why.ensureWhyStyle()` and `repaintLinkIcons(groups, homeLinks())`, which sets the new tile on
  each link row's `<img>` (Settings, More Sources). The theme lists' live preview changes `data-style` too, so the
  icons follow the preview as well.
- `why.js`: `WHY_CSS` dropped; `ensureWhyStyle()` remembers which style it wrote (a WeakMap on the `<style>`) and
  rewrites the same element when the style changed. Still writes nothing on a repeat call for the same style.
- Tests: `homefeatured.test.js` (B239 cases: render-time gear, repaint, followStyle start/stop, Why CSS rewrite,
  no import-time tiles left); `icons/rowicons.test.js` and its two references moved to `settingsIcon()` /
  `whyCss("ios6")` (needed: they imported the removed exports).

Checked:

- `node --test` on the three test files: pass.
- `node tools/smoke/smoke.mjs`: passed.
- A scratch headless Chromium run (smoke.mjs's launcher + steps of its own, not committed): Home open, then
  `settings.set("style", "ios7")` from the page: the Settings gear, More Sources' tile and the Why tile CSS become
  iOS 7's with no reload, and back to iOS 6's at once; no page errors.

Tried and failed: the first scratch run stopped at a ReferenceError in my own script (cut smoke.mjs two lines too
short), which skipped its cleanup, so that run's headless Chromium may have outlived it.

**Not verified**

- On a phone (iPhone 7 / 15): no device step needed for a DOM repaint that headless Chromium showed; not run.
- The real browser check was not run against main to watch it fail first; the unit tests cover the old behaviour
  (they fail with the import-time constants).
