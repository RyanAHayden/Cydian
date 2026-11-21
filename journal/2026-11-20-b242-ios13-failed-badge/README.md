# B242: iOS 13 failed-row badge, flat systemRed

## What changed

- `web/app/packages.css`: the failed-row badge on Sources (`.source-row.is-failed .cell-count.row-failed-badge`, the
  red "!") now reads two tokens, `--row-failed-badge` and `--row-failed-badge-shadow`. Their defaults on `:root` are
  the old gradient and shadow, so iOS 6 (and iOS 7, which sets neither) look the same as before. This follows how B241
  set up `--sig-pill*`.
- `web/app/ios13.css`: both tones set the badge flat systemRed with no shadow: White `#ff3b30`, OLED Black `#ff453a`
  (the same reds as `--sig-pill-expired`).
- `web/app/ios13-failed-badge.test.js` (new): checks that the look-only rule reads only the tokens, that iOS 6 keeps the
  gradient as the default, and that both iOS 13 tones set the flat reds with no shadow. It is a separate file, not an
  addition to B241's `ios13-flat.test.js`, so merges stay clean.

## Check

- `node --test` on the new test, `ios13-flat.test.js` and `ios6-css.test.js`: 23 pass.
- Shots (3x, 402 px wide, headless Chromium on `file://`): `badge-shot.html` here loads the real CSS files
  (style, ios6, sources, packages, ios7, ios13) around a static failed row and a normal row. To run it again, copy it
  into `web/app/` (it uses relative CSS paths), and pick the look with `?style=` / `&theme=`.
  `shots/ios13-light.png` and `shots/ios13-dark.png` show a flat red "!" capsule. `shots/ios6-light.png` still
  shows iOS 6's glossy badge. The page has no ground colour, so the PNGs show the rows on black/transparent.
- `tools/check.sh`: run by `run done`.

## Not verified

- The badge on the real Sources page during a refresh with a source that fails: the shot uses static markup, not
  the app's own rows. Faking a failing source on the fake bridge would take far more setup than a two-token change
  needs, and the selector and markup are the ones `screens/sources.js` paintRow writes.
- Not checked on a phone (the iPhone 15 Lite build or the 7): a CSS-token change in one look, so not worth the phone time.
