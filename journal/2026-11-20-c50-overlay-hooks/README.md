# C50 Era readiness: nav/ overlays

Goal: the overlays `nav/` draws take their iOS 6 art from CSS a style can swap, and docs/eras.md lists each
overlay's classes as named hooks.

## What was in JS, and where it went

- `nav/hud.js`: `hide.done()` swapped the spinner for an inline `<svg class="hud-check">` with `stroke="#fff"`. Now a
  `<span class="hud-check">` painted by `ios6.css`'s new `--hud-check` token (the same SVG as a data URL) in the HUD's
  look-only stretch. Its scale-in animation and size (`style.css .hud-check`) are unchanged.
- `nav/sharesheet.js`: the Copy and QR glyphs were inline SVG strings (`currentColor` = `--share-system-glyph`
  #f4f4f4, black overlays). Now `<span class="share-glyph glyph-copy|glyph-qr">` painted by `--share-glyph-copy` and
  `--share-glyph-qr` (data URLs with #f4f4f4 written in); `--share-system-glyph` went (nothing else read it), the
  emboss filter stays on `.share-glyph`. `style.css`'s box rule now targets `.share-glyph` instead of `svg`. The
  app's own colour stays a `--share-tint` custom property set from JS (it is data, not art).
- `nav/lock.js`: built the padlock SVG with `#8a8a8a` in DOM calls. Now a `<span class="lock-icon">` painted by
  `sources.css`'s `--lock-icon` (look-only stretch), sized 9 x 12 / 14 x 18 in `sources.css` layout rules (the old
  `width`/`height` attributes: `round(size * 12 / 16)` x `size`), `contain` keeps the 12:16 art centred as the
  SVG's default `meet` did.
- `nav/ui.js`: a row icon's colour was `icon.style.background = color`. Now `--cell-icon-tint`, read by `ios6.css`
  `.cell-icon { background: var(--cell-icon-tint, var(--cell-icon)) }`, with new tokens `--cell-icon` (#8c99b3)
  and `--cell-icon-text` (#fff). The inline style used to beat every rule; checked that no rule heavier than
  `.cell-icon` sets a background on a cell icon that also gets a colour (row-icon, find-more, browse-icon rows never
  pass one), so the cascade result is the same.
- `nav/spinner.js`: nothing to move. The app never loads it; it generates `ios6.css`'s `--spinner-*` tokens and
  `spinner.test.js` keeps them equal. Added a comment saying so and that an era sets its own tokens.
- The other overlays (alert, action sheet, reload bar, section index, row swipe, banner, undo bar, menu) already
  drew no colour or art from JS (their inline styles are position, drag and swipe offsets). Their look rules are
  still literal colours in `ios6.css` / `packages.css` / `sources.css`; those are the queued per-sheet cleanups
  ("the rest of ios6.css", "the other stylesheets"), not this task.
- `docs/eras.md`: new "Overlays (nav/)" table under Hooks: each overlay's JS, classes and states, and where its look
  lives (tokens or literal). Dropped "the art the overlays in nav/ draw from JS" from Not yet clean.

Files outside the brief's list, needed because the art had to land in CSS: `web/app/ios6.css`, `web/app/style.css`
(one selector), `web/app/sources.css`.

## No visible change

`shots.mjs` here is C44's harness plus overlay shots: Theme (the gradient swatches through `--cell-icon-tint`),
Manage > Sources in edit mode (`.source-lock`), Sources with the HUD ended on Done, Sources with the share sheet
open (Copy, QR, an app letter on its colour). 6 themes x 11 routes + 2 site shots = 68, at 3x. `diff.py` is C44's.

- main (0638d1ac, scratch worktree) vs this branch: **0 px on all 68 shots**. Style differences only the new
  `span.hud-check`, `span.share-glyph.*`, `span.lock-icon` (listed "only after": the dump skips SVG elements, so the
  old SVGs never showed).
- `node --test web/app/nav/*.test.js web/app/ios6-css.test.js web/app/palettes.test.js web/app/icons/*.test.js`:
  225 pass (spinner.test.js included).
- `node tools/smoke/smoke.mjs`: passed (pushes, pops, sheet, transform/opacity only, no page errors).
- `tools/check.sh`: run by `run done`, which refuses to tick unless it passes.

## Not verified

- On a phone (iPhone 7 / 15): background-image SVGs rendering the same as inline SVG in WebKit. Checked only in
  headless Chromium; the change is ordinary CSS and the same SVG markup, so no phone run.
- The website's HUD/share sheet with `--pressed`: not shot (the pressed run covers the bar buttons and cells, which
  this task didn't touch).
