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
  `homeGlyphRules("ios7")` under `html[data-style="ios7"]`, plus: the green row's `--tile-glyph-green` and Settings >
  Signing's app-offer glyph in iOS 7 green (#4cd964), and the glyph tile at the row tiles' 6.5pt corners with a 20pt
  glyph.
- GitHub's iOS 7 entry has no colour of its own, so the dark theme's `--dk-glyph` rule still wins (ios7.css loads
  after home.css at the same specificity, so a colour there would beat it).
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
- The certificate tile's glyph keeps its stage ink (`--cert-ink`, iOS 6's amber/red) in iOS 7: it is the tile's
  state colour, not a tile colour, so I left it.
- iOS 13 still shows iOS 6's Home glyphs (ios13.css is B241's era; not in this task's files).
