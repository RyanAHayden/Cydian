# C51: per-style icon map

## What I did

- `web/app/icons/rowicons.js` now holds the icon map, `ICON_SETS`, with iOS 6's set `ICON_SETS.ios6`: `rows`
  (the existing `ROW_ICONS`), `glyphs` (`GLYPHS`), `tile` (29pt, 6pt corners, 19pt glyph), `guides` (Copying Files'
  tiles, moved from `screens/guides.js`), `home` (the Why tile's star, moved from `screens/why.js`'s CSS string) and
  `tabs` (the six tab glyph SVGs, the same art as `ios6.css`'s `--glyph` tokens).
- Lookups: `iconStyle(doc)` reads `<html data-style>` (iOS 6 when unset), `icon(kind, name, style)` falls back per
  name to iOS 6's entry, so an era set names only what it redraws. `tileSvg`, `rowIcon` (cached per style),
  `guideSvg`, `homeTileCss`, `tabGlyphTokens`, `cssSvgUrl`.
- `screens/guides.js`: `glyphSvg`, `glyph`, `GLYPH_IDS` read the map. `screens/why.js`: `whyCss(style)` builds the
  page CSS with the tile from the map; `WHY_CSS` stays (iOS 6) and `ensureWhyStyle` uses the document's style.
- `notiphone.js`, `manage.js`, `handoff.js`, `account.js` had no inline art of their own: only `rowIcon` (already
  the map) and QR codes (`core/qr.js`, excluded). A test now fails if any of the six screens gains an inline SVG.
- Tab glyphs "join the map as tokens": the map is the source and `rowicons.test.js` checks that `ios6.css`'s six
  `.tab[data-tab]` rules are exactly `tabGlyphTokens("ios6")`, and that any era set with tabs has its rules in
  `ios<N>.css`. I did not change `ios6.css` (not in this task's files, and other era cleanups are editing it);
  generating the rules at runtime instead would have put the tab art behind JS and left a duplicate in CSS.
- docs/eras.md: new "Icon map" section; the "inline SVG icons" item left the not-yet-clean list.

## Choices

- The map lives in `rowicons.js`, not a new module: app.js's static closure is at 116 against
  `module-graph.test.js`'s bound of under 117, so any new startup module fails the gate, and `rowicons.js` already
  loads at startup (Home). The guide tiles (about 2.5 KB) now load at startup with it; `screens/guides.js` stays lazy.
- `Object.prototype.hasOwnProperty.call` instead of `Object.hasOwn` (iOS 15.4+; the app runs on 15.0).

## Checks

- Every generated string is byte-identical before and after: all `tileSvg`/`rowIcon` outputs, `glyphSvg`/`glyph` for
  every guide tile, `WHY_CSS`, `SETTING_ICONS`, `PAGE_ICONS`, `GLYPH_IDS` (a JSON snapshot diffed with `cmp`).
- 3x screenshots + computed styles with C44's `shots.mjs`/`diff.py`, HEAD (`git archive`) against this branch:
  44 shots (6 themes x app pages, plus the website), 0 px and 0 style differences.
- `node --test web/app/`: 2600 pass, 0 fail. `tools/check.sh` through `run done`.

## Not verified

- The Copying Files guide page and the Why page are not among `shots.mjs`'s pages, so no screenshot of them was
  diffed; their SVG and CSS strings were compared byte for byte instead, which covers what they draw.
- No era set exists yet, so the fallback and `ios<N>.css` tab-token checks run only against a temporary test set.
