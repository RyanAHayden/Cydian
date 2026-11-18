# F159: Home's Settings icon matches the tile glyphs

## What I did
- `homeLinks()` Settings row: `icon: { cls: "home-glyph glyph-settings" }` in place of `icon: { src: "icons/settings.svg" }`
  (`SETTINGS_ICON` now holds the class list).
- `nav/ui.js` `cell()`: added optional `row.icon.cls`, which is added to the `.cell-icon` span. This is the only change to shared code, and it only adds.
- `home.css`: `.home-settings-row > .cell-inner { padding: 0 10px 0 6px; gap: 8px }` (the `.home-tile` values) and
  `.glyph-settings`: #8e8e93 square with a white gear as an inline SVG data URI (8 teeth drawn as a dashed stroke ring, plus a body with a hole).
  The old full-bleed `img` rules are removed.
- Deleted `web/app/icons/settings.svg`: grep found nothing else using it (web, native, worker, tools).
- Tests: `screens/homefeatured.test.js` checks that the row's padding and gap equal `.home-tile`'s, that the glyph is grey with a white inline SVG,
  and that `grouped()` puts the classes on the cell-icon with no `<img>`. `home.test.js` has the updated expected row.

## Checks
- Headless Chromium at 3x (390 wide), website Home: Settings' icon left edge, 29px size and label x match Signing/Featured
  (crops compared zoomed in). The first gear had a faint seam where its teeth met the body (both edges at r=7.5),
  so I widened the tooth stroke to 3.4 so the two overlap. The re-render is solid.

## Not verified
- The app (WKWebView) render was not checked on a phone: the task didn't permit driving the iPhone 7's screen. The row uses the same
  `web/app/` CSS and DOM in the app, so the result should match the website render.
- Dark theme: not rendered. `.glyph-settings` sets only its own background colour, as the other glyphs do.
