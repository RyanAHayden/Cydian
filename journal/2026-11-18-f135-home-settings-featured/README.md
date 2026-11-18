# F135 Home changes: Settings up with an icon, the jailbreak app's banners move to Browse, placeholder cards

## What I did
- `screens/home.js` `homeLinks()`: Settings is now the first group, directly under the tiles and above the help
  links, with `icon: { src: "icons/settings.svg" }` and `cls: "home-settings-row"` (grouped()'s existing row icon).
  The website's locked-Home code finds the Settings group by label, so it still stays unlocked.
- `web/app/icons/settings.svg`: our own grey gear on a grey rounded square (gradients, 12 teeth from a dashed ring),
  58x58 viewBox, 29x29 size. One SVG instead of 1x/2x/3x PNGs (the brief allowed either; an SVG is sharp at every
  scale). `home.css` drops the generic blue `.cell-icon` box and fills the cell with the picture.
- `homeShowsFeatured(mode)` / `browseShowsFeatured(mode)`: the jailbreak app's Home no longer draws `homeFeatured()`
  (Reload's redraw doesn't bring it back); Browse's page (`renderBrowse` in home.js, the `#/home/browse` page, not
  browse.js which is the package pages) shows it at the top there. Website and sideload: Home keeps it. Decision:
  the brief says "unless it's the same scroller, in which case jailbreak only". It is the same scroller
  (`homeFeatured`) in all three builds, so only the jailbreak build changes. (Site/sideload draw nothing there while
  Not Jailbroken anyway.)
- `screens/extras.js` `homeFeatured()`: while the sources/banners load it shows `featuredPlaceholder()`, two grey
  pulsing cards with the banners' own `featured-banner` box (size, ratio, corners) plus ui.js's `.ph-box` look; they
  give way to the banners, or the box empties (and hides) when there are none or the load fails. Takes injectable
  `deviceType`/`sources`/`forHome` for the tests.
- Tests: `screens/homefeatured.test.js` (row order, icon, jailbreak Home without / Browse with the scroller,
  placeholders then banners, empty/failure/Not Jailbroken) over a small fake DOM; `home.test.js`'s F123 order test
  updated to Settings first.

## Tried and changed
- The first gear had thin, spiky teeth (7px ring, half-width dashes); widened the dashes and shortened the ring.
  Checked by rendering with rsvg-convert at 3x.

## Not verified
- The real Home and Browse pages in a browser or on the iPhone 7: the jailbreak app's Home without the scroller and
  Browse with it at the top, and the placeholder cards' look beside real banners, were checked only by node tests
  (predicates, source checks, fake-DOM homeFeatured), not rendered. No task permission to drive the phone, and the
  full renderRoot needs the whole app's DOM.
- The gear's look next to iOS 6's real Settings icon: no `ref/` comparison was made (only a render of our SVG).
