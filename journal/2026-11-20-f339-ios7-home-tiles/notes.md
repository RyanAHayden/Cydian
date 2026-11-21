# F339: iOS 7 Home tiles

## What I did

- `web/app/icons/rowicons.js`: every `.glyph-*` tile home.css drew (GitHub, Sources, Discord, Featured, Themes,
  Browse, Signing, Install, Send, the green row's Add / Upgrades / Failed / Current / Changes / Loading, Jailbreak,
  Theme) is now an entry of `ICON_SETS.ios6.home`, its SVG byte for byte what home.css had. `ICON_SETS.ios7.home`
  redraws each one: flat iOS 7 colour (`C7`, no gradients), white line glyph at the row glyphs' 1.9-unit line, most
  reusing `GLYPHS_7` (list, apps, install, plus, check, clock, contrast); new line drawings for Discord (Clyde's
  outline, eyes as dots), Themes (monitor), Signing (page + seal), Send, Upgrades, Failed, Jailbreak (open padlock).
- New `homeGlyphRules(style)` prints one `.glyph-<name>` rule per tile (Why left to why.js). `homeTileCss` now takes
  a tile with no colour (the row gives it) or no gradient.
- `home.css` keeps the iOS 6 rules where they were, now exactly as `homeGlyphRules("ios6")` prints them (Discord's
  trailing comment moved into the map, `.glyph-changes, .glyph-loading` split in two). `ios7.css` carries
  `homeGlyphRules("ios7")` under `html[data-style="ios7"]`, plus the green row's `--tile-glyph-green` (#4cd964) and
  the certificate tile's stage ink in iOS 7 orange/red (the Signing Needs Setup tile's glyph colour).
- GitHub takes iOS 7's dark grey (#4a4a4f); `html[data-style="ios7"][data-theme="dark"] .glyph-github` puts the dark
  theme's `--dk-glyph` back, since ios7.css loads after home.css and would otherwise beat its dark rule.

## Spec review

- Fixed: GitHub had kept iOS 6's #333, and the certificate tile iOS 6's ink, against "in iOS 7 colours".
- Reverted, filed as a follow-up: Settings > Signing's app-offer glyph in iOS 7 green, and the glyph tile at 6.5pt
  corners with a 20pt glyph (geometry/outside Home, not asked).
- `rowicons.test.js`: home.css holds every iOS 6 rule and no other painting `.glyph-*` rule; iOS 7 redraws every tile,
  flat, line, iOS 7 colours, and ios7.css carries the rules; every glyph name home.js uses is in both sets.
- `screens/home.js` needed no change: it already only sets `glyph-<name>` classes, and the CSS follows a live
  Style switch by itself.

## Checked

- `node --test web/app/icons/rowicons.test.js`: 17 pass.
- A 3x contact sheet of each tile, iOS 6 beside iOS 7, from headless Chromium: `tiles-ios6-vs-ios7.png` here.

## Not verified

- Home itself under iOS 7 on a phone or in the full app page (only the tiles on a contact sheet): no phone task, and
  the sheet draws the same CSS the page gets.
- The certificate tile's tints (`--cert-bg`/`--cert-edge`) and the expired tile's #8f1a12 glyph stay iOS 6's; only
  the ink moved. The contact sheet was drawn before the review's GitHub colour change.
- iOS 13 still shows iOS 6's Home glyphs (ios13.css is B241's era; not in this task's files).
