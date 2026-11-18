# F205: iOS 6 Settings row icons; Display -> Theme

## What I did

- `web/app/icons/rowicons.js`: one SVG tile generator (`tileSvg`, `rowIcon(name)` -> a grouped() row `icon`
  `{ cls: "row-icon", src: data:image/svg+xml }`), ~45 icons (colour + white glyph, all drawn here, no Apple art),
  `SETTING_ICONS` (core/settings.js keys -> icon) and `PAGE_ICONS` (Settings pages -> icon).
- Sizes measured off the 4S, not guessed:
  - Pulled Preferences.app's `Bluetooth@2x.png`, `dnd@2x.png` etc. over ssh (read-only, into the scratchpad, not
    committed). They are CgBI-crushed PNGs; decoded with a small script (raw deflate, BGRA, premultiplied).
    58x58 @2x = 29pt; first opaque pixel 9px in on row 0 -> ~5pt corners; 0.5pt dark edge (alpha 151 of a dark
    shade of the tile colour); the body is darkest at the gloss line (~y 26px of 58) and lighter to the bottom
    (#585d65 -> #8c9097 on the grey tiles); the gloss is white over the top ~44% with a shallow downward curve.
  - Took a 4S screenshot of Settings' root (`tools/ui-4s.sh F205 shot settings-root`, under the lock, unlocked
    after; stays in ref/4s/screens/, gitignored). Group content edge x=20px, tile 34..91px, label at 115px:
    tile 7pt in, label 11pt after the tile (47.5pt from the cell edge).
  - ios6.css `.cell-icon.row-icon`: no background/shadow (the SVG draws it all), `margin: 0 3px 0 -3px` turns
    `.cell-inner`'s 10px padding / 8px gap into 7 / 11. Measured on our 3x render: tile 21px (7pt) in, label at
    47.7pt. Same in dark theme (the tiles don't change, as iOS 6's didn't).
- Rows given a tile: Settings root (Account, General, Theme, Updates, Signing, Open in App, Install from URL,
  Console Logs); every setting row on General/Updates/Signing (toggles, lists, Ignored Upgrades); Sideloading's
  Open Other Apps' Links; Website's Lock Home and Install on the Website; Signing's How Signing Works and the Signing
  Server group (Server, Check Server, Run Your Own); Bring My Certificate; Account (Create Account, Sign In With Key,
  Sync Now + Last Synced, Sync Certificate, Show/Hide Account Key); Manage (Sources, Import & Export, Hidden,
  Recommended); Import & Export (all six actions).
- Left bare, on purpose: Theme > Appearance's Automatic/Light/Dark (option rows, as iOS 6), list pages' options,
  the certificate/profile value rows and Import/Replace Certificate (a value group), Remove Certificate, Update
  Alerts (iOS's own status rows), the account key group (the key itself is a row), Console log entries.
- Sources tab: tried tiles on All Sources / Recommended Sources, but All Sources already has Cydia's folder icon there
  (two icons side by side in the render), so reverted; that list stays Cydia's. Home's link list (Help, Find
  Extensions, User Guides, Credits) is Cydia's home and stays iconless.
- "Extras" in the brief: there is no Extras submenu with rows (screens/extras.js is paid-package/featured pieces);
  nothing done there.
- Display -> Theme: `PAGES` id `display` -> `theme`, title Theme; SECTIONS' `display` group removed; `compatMarks`
  moved to section `compat` (General, right after Works on My Phone). Theme holds only Appearance. The old route
  `settings/display` still opens Theme (screens/settings.js `OLD_PAGES`). The compat group's combined footer had
  to stay under the 120-char limit (core test), so Compatibility Marks' footer is now "Marks put a check, an X or
  a ? by each package." docs/settings.md updated.
- Tests: icons/rowicons.test.js (every icon draws a 29pt / 5pt-corner tile, every SETTING_ICONS key is a real
  non-choice setting and every shown non-choice setting has one, ios6.css spacing rule); settings.test.js renders
  root/General/Theme/`display` through a fake DOM and checks which rows carry tiles; core/settings.test.js layout
  updated for Theme and the moved Compatibility Marks.

## Tried and changed

- Gloss opacity .62 -> .28 first: next to the 4S's Wi-Fi tile (zoomed 3x render) the top was too grey (182 vs 219);
  now .74 -> .45 (204 vs 219 at the top, 167 vs 176 at the gloss's foot). The purple DND tile's gloss is weaker
  than the grey's, so one white ramp is a compromise between them.

## Renders checked (3x, headless Chromium, 320pt wide, `node worker/node.mjs`)

Settings root (side by side with the 4S screenshot), General, Theme, Updates, Account, Signing, Manage, Import &
Export, Sources, Manage in dark. Kept in the session scratchpad only (the comparison includes the 4S screenshot,
which is Apple UI and stays out of the repo).

## Not verified

- On a real phone (iPhone 7 / the jailbreak app, sideload build): not run, the task didn't call for the phones;
  only headless Chromium renders. The tiles are `<img>` data: SVGs, which WKWebView draws the same way.
- At 320pt wide, switch rows with long labels truncate more now that a tile takes 36pt ("Works on My Ph…",
  "Compatibility Ma…", "Refresh Sources …"). At 375pt (iPhone 7 and later) "Works on My Phone" and "Compatibility
  Marks" fit by arithmetic (375-20-2-7-29-11-77-9 = 220pt); not rendered at 375.
- Sideload-only and jailbreak-only rows (Signing options, Sideloading, Automatic Installs, Console Logs, Bring My
  Certificate) were only checked by code and tests, not rendered: the site build doesn't show them.
