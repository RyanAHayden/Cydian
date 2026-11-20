# B161: pull to refresh area wears the page's own background

User screenshot (website Home in a phone browser): after B160 the pull area was white everywhere, so on Home, a
grouped (pinstripe) page, a white band sat over the pinstripes.

## Fix

- `web/app/nav/pullrefresh.js` `ensure()` (runs once per touch at the top, never per frame): the clip box gets
  class `grouped` when its scroller is a grouped page (`.page-body.grouped`, app.js sets `grouped`/`plain` from the
  page's `style`). Plain lists (Sources, Changes, Search, Installed) stay without it.
- `web/app/ios6.css`: `.pull-clip.grouped > .pull-refresh` draws the same pinstripe as `.page-body.grouped`
  (`--pin-dark`/`--pin-light`, which every theme sets). The plain area keeps B160's `var(--plain)`, set once for
  the whole pull, so there is still no colour change mid-pull.
- `web/app/palettes.css`: Linen paints its grouped pages with `--weave`, not the pinstripe; a separate rule gives the
  grouped pull area the weave too. Kept out of the existing `:is(...)` list on purpose: adding a 3-class selector
  there would have raised that rule's specificity for `.boot`, `.filter-drop-inner` and `.review-sheet` as well.
- `pullrefresh.test.js`: the grouped area's background must equal `.page-body.grouped`'s, Linen's rule must exist,
  and the JS must set the class from the scroller; the B160 test allows exactly this one extra background rule.

The stripes line up across the seam: both are vertical stripes from the same left edge (checked zoomed at 3x).

## Check

`capture.mjs` (B160's copy), `make_script.py` → `script.json`: Chromium 390x844 DPR 3, held script-mode pulls under
(55 pt of finger) and past the trigger on Home and Sources, in Classic light, Gunmetal and Linen, as the website and
as the app shell (`--mode sideload`, fake bridge). Each pull goes back under the trigger before the lift so no refresh
starts. Computed area background while held (same in web and app):

| page / theme | clip class | background |
|---|---|---|
| Home, light | grouped | pinstripe rgb(203,208,218)/rgb(206,211,220) |
| Sources, light | (plain) | rgb(255,255,255) |
| Home, Gunmetal | grouped | pinstripe rgb(43,46,51)/rgb(48,51,56) |
| Sources, Gunmetal | (plain) | rgb(37,39,43) |
| Home, Linen | grouped | the weave over rgb(54,56,61) |
| Sources, Linen | (plain) | rgb(42,44,48) |

`pulls.png`: top row website, bottom row app; per theme Home under/past, Sources under/past (Classic, Gunmetal,
Linen left to right). Revealed space, arrow and text sit on the page's own background in all 24 shots.

## Not verified

- On a phone (iOS rubber band, native-mode pull): no phone driving in this task. The class is set in `ensure()`,
  which both the native and script paths call before the area shows, so the first visible frame already has it.
- Sepia, Solarized, Midnight, Dracula, Nord, OLED not shot: they only change `--pin-*`/`--plain` tokens, which the
  rules read (OLED's pinstripe tokens are flat, so its grouped area is flat too, like its pages).
- Grouped pages other than Home (Settings has no pull to refresh today) and Changes (plain, unchanged from B160).
