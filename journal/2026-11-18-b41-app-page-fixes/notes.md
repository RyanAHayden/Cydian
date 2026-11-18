# B41 App page fixes: Related tab icons, header insets

## (1) Related tab icons
Cause: the CSS. `.store-related-icon` only had `overflow: hidden`. The `<img>` that `nav/ui.js` puts in the
`.cell-icon` had no size or position. `.cell-icon` is `display: grid`, so the picture was laid out at its own size
(120px in the harness, often 512px for real icons) as a second grid row under the letter. The 29px tile showed a
slice of each (`before-3x-light.png`: grey top, orange bottom). mediaUrl was fine for https/data/http icons. Failed
loads already fell back, because ui.js removes the `<img>` on error.

Fix:
- `packages.css`: `.store-related-icon` is `position: relative`. Its `img` is absolute, `inset: 0`, 100% × 100%,
  `object-fit: cover`, hidden until `.loaded` (ui.js sets that on load), the same rules as the source and My IPAs rows.
  The letter shows while loading, when there is no icon, and after a failure.
- `browse.js`: the row comes from a new exported `relatedRow(r, route)`. The picture URL now goes through `iconSrc`,
  which also skips icons that already failed in a package list. The letter falls back to the id's first letter, then "?".

## (2) Header insets
`.store-head` padding went from `14px 10px 30px` to `14px 21px 30px`. 21px is the grouped rows' content line: the
`.group` margin (10) + the table border (1) + the `.cell-inner` padding (10). The task says "the same inset as the
page's grouped rows". The card edge is at 10px, and the icon was already there, while the user asked for more room.
So I took the rows' contents, and the header icon now lines up with the Related rows' icons and the
section header. This applies to package pages and app pages alike, because both use `storeHeader`.

## Checks
- `node --test web/app/screens/storepage.test.js web/app/screens/browse.test.js`: 22 pass. New tests in
  storepage.test.js (it has the fake DOM):
  - relatedRow's src and letter: https, file:// gives none, an empty name uses the id.
  - Through ui.js grouped: the picture sits over the letter, and `onerror` leaves the letter tile.
  - The CSS rules for both fixes.
- Renders at 3x, headless Chromium, 375pt wide, `harness.html` (serve `web/`, copy it there): `page-3x-light.png`,
  `page-3x-dark.png`, `before-3x-light.png` (old packages.css). I checked them zoomed in. The icon's left edge
  and the Share button's right edge are both 21pt (63px) from the edges, level with the row icons and the card's
  content. The loaded picture fills the rounded tile. The failed and the no-icon rows show the letter tile.
- `tools/check.sh` via `agent-runner done`.

## Not verified
- Not checked on a real app page in the app or on the site, only in the harness. A live page needs a source loaded,
  and it goes through the same `storeHeader` / `relatedRow` / ui.js code.
- Not checked against an actual iOS 6 App Store header on the 4S. The task did not call for the phone, and the
  inset target came from the brief's "same inset as the grouped rows".
- Not checked on the iPhone 7 (WebKit). It is the same CSS approach as the source rows, which already render there.
