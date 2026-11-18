# F181: the package page as the iOS 6 App Store's

Built from the concept in `journal/F181/concept/` (TweakDetails, TweakReviews), with the user's one change: Install /
Modify stays the nav bar's right button. Applies to APT packages (`browse.js renderPackage`) and AltStore apps
(`altstore.js renderApp`) alike.

## What I did
- New `web/app/screens/storepage.js`: `storeHeader` (72px icon with gloss + `-webkit-box-reflect`, name, author, stars row
  only when there is a rating, "Version · size · price"), `storeTabs` (Details / Reviews / Related; Reviews and Related
  fill the first time they're opened), `tileRow` + `worksOnTile` / `ratingTile` / `sizeTile` / `sectionTile` /
  `updatedTile` (tiles keep a fixed order whenever they arrive), `ratingsCard` (5-to-1 bars only when per-star
  counts exist, drawn with `scaleX`), `reviewsGroup`, `whatsNewGroup` (notes + Version History in one card).
- `core/previews.js`: `sileoRatings(json)` (RatingView average, ReviewViews, else the reviews' mean) and
  `sileoWhatsNew(json)` (the newest entry of a Changelog / What's New tab, including one Markdown view with `## 1.2`
  headings).
- `renderPackage`: header → tabs. Details: payment group, screenshots, tiles, Description (or the Sileo depiction as
  the body, its ReviewViews moved to the Reviews tab), What's New + Version History, Information (Developer,
  Maintainer, Source, Package, Version, Installed Size, Architecture, Depends, Compatibility; `fit.detail` as footer),
  More by <author> + Depiction (HTML) row, Links (Support), then the Cydia groups as before (queue slot, Installed
  Package, rollback, problems, Depends with links, Conflicts, Sources, Open In, .deb, footer). The Sileo JSON is now
  fetched once and shared (`loadSileo` takes the promise). Related: `catalog.list(key, section)` minus itself, max 50.
- `renderApp`: same header and tabs; App Store rating → stars, Rating tile, Reviews tab; category → Section tile;
  `v.date` → Updated tile; What's New card replaces the old What's New + Version History groups; "Details" is now
  "Information"; Works On tile replaces the Works on My Phone group and follows the IPA read (F160). Returns
  `{ details }` so browse.js appends the jailbreak Installed App group into the Details pane.
- Screenshot strip (`altstore.js galleryGroup`, both pages): page dots under it (one per picture, follows scroll in a
  rAF, follows pictures that drop out) and tap-to-zoom (`zoomShots`: black full-screen layer, sideways snapping, grows
  from the thumbnail by transform, fades by opacity; tap closes).
- CSS: page in `packages.css` (F181 block, light + dark), segmented control in `ios6.css` with colours sampled from
  the 4S's `UISegmentButton` / `UISegmentButtonHighlighted` / `UISegmentDivider` (Shared@2x), `background-origin:
  border-box` on every gradient.
- Tests: `screens/storepage.test.js` (header with and without rating, tabs, Works On, tile order, ratings card,
  reviews, Install stays in the nav bar and no header button, CSS present) and two in `core/previews.test.js`.

## Checked
- `node --test web/app`: 1059 + new, all pass.
- A 3x render in headless Chromium of a harness (`harness.html` here: the real CSS and storepage.js, with made-up data
  like the concept's) in light and dark, Details and Reviews, with and without a rating: `*.jpg` (half size) and
  `zoom-3x-header-reviews.png`. Zoomed in: no light line under the segments, gloss and reflection clean. Fixed one
  thing that showed up: the 5-star label in the bar chart ran into the bar.

## Decisions (no one to ask)
- Stars are the concept's orange (`.store-stars`), not depiction.js's grey `.dep-stars` (which stays for depictions).
- Sileo ratings: count = number of ReviewViews, labelled "Reviews", because a depiction never says how many people
  rated. No bar chart from those reviews: a repo picks which reviews to show, so a histogram of them would mislead.
  The card supports `histogram` for F182.
- Information keeps a short "Depends" row (first names), and the linked Depends group stays below it: a Cydia user
  still needs to open each dependency.
- Header price: "Free", "Paid" for `cydia::commercial`, none for installed-only. AltStore apps: "Free".
- Updated tile only where there's a date (AltStore `versions[0].date`); APT stanzas have none.
- Write a Review / Report a Problem / Tap to Rate left out until F182, as the brief says.

## Not verified
- **The real page with live sources** (renderPackage / renderApp in the app or on the site): no backend or catalog
  ran here. Only the harness was drawn. The wiring is checked by tests that read the source plus module import,
  not by a live render. To check: open a package that has a Sileo depiction with reviews (e.g. on Chariz or Havoc) and
  an AltStore app, both tabs, light and dark.
- **Tap-to-zoom and the page dots in a real browser**: they weren't driven (no CDP script this run). Neither was
  WebKit's `-webkit-box-reflect` on an iPhone; Chromium draws it, and Firefox doesn't, where you just get no
  reflection.
- **120 Hz on a device**: not measured. Only transform and opacity animate (zoom open/close); the bars use scaleX.
- `:has()` for the segmented control's outer blue edge needs iOS 15.4+; on older iOS the edge stays grey.
