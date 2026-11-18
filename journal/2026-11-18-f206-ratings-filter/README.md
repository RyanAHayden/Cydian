# F206: ratings breakdown with a star filter, and no pop-in on an app page

## What changed
- `screens/storepage.js ratingsCard(r, { reviews, selected, onPick, pending })`: always draws the five bars beside the
  average. Each row is a `<button>` (min-height 32px, 1px divider between rows) with five small stars (the rating's
  dark #6d6d6d, the rest light grey), the grey bar (scaled with `transform: scaleX`), the count in `<b>`, and a chevron.
  The bars use the source's histogram (ours, when it is the only source). Otherwise they count the written reviews
  passed in (ours, the depiction's, the App Store's; `core/reviews.js starCounts`, half stars rounded). The line
  under the card says where they come from ("Bars from 5 reviews." / "Bars from 212 ratings." / "No reviews to count
  yet."), after `r.from`. This overrides F181's "no bars from depiction reviews", as the user asked.
  `.select(stars)` marks a row (iOS 6 `--select` blue, `aria-pressed`) and switches the hint line ("Tap a row to see
  only those reviews." / "Showing 4-star reviews. Tap the row again for all."). Pressed state:
  `:not(:disabled):active` / `.is-pressed`, a grey wash.
- `screens/reviews.js reviewsTab`: while it loads, the card's skeleton (`pending: true`, the same rows, "—", "Loading
  Reviews…" in the from line) replaces the spinner. A row filters the list below to that rating. The filtered view
  is one group, "4-Star Reviews (3)", holding all matching reviews: ours, the depiction's and the App Store's.
  It shows "No reviews with this rating." when none match, then "Show All N Reviews". The same row again, or Show
  All, clears the filter. The list fades in by opacity only. The filter survives the redraw after a post (the
  `filter` option). The function returns `{ card, area, setFilter, filter }`.
- Header: the stars row exists from the first paint (grey empty stars, `data-state="pending"`). It is filled in place
  and says "No Ratings" when there is no rating, and is never hidden. CSS gives it a fixed height of 15px.
- Tiles: `tileRow()` starts with the Rating tile's placeholder (`pendingRatingTile()`: "—" over grey stars).
  `ratingTile(r)` never returns null: with no rating it gives "—" with "No Ratings" under it. In CSS, the stars
  (10px + 1px margin top and bottom) take the same 12px as the sub line, so all three forms are one height.
  `tileRow({ rating: false })` leaves the placeholder out.
- browse.js and altstore.js needed no change: both already call `header.setRating` and
  `tiles.set("rating", ratingTile(r))`, and the placeholders now come from storepage.js. altstore's `storeLookup`
  never rejects, so its `.then` always fills the row ("No Ratings" when the App Store has none).

## Checks
- `node --test` on storepage.test.js, reviews.test.js and core/reviews.test.js: 29 pass. New tests cover: bars counted
  from reviews; the filter on, the same row again, another row, and Show All; none for a rating; the skeleton with
  the same card shape as the filled card; the header row and Rating tile from placeholder to filled in the same
  element and slot; no ratings keeping all three; the CSS for 32px rows, the divider, the blue, the pressed state and
  transform-only.
- 3x renders in headless Chromium of `harness.html` (the real CSS and modules with made-up data): `reviews.png`
  (unfiltered), `reviews-4star.png`, `reviews-3star-none.png`, and `head-compare.png` (header and tiles before
  reviews load / loaded with "(1)" / no ratings). The tabs, tiles and Description sit at the same y in all three.
- Measured in Chromium (`harness.html?measure`): the card is 200px as a skeleton and 200px filled.
- `tools/check.sh`: run by `agent-runner done`. The first run failed theme-palette.test.js ("every dark rule paints
  with tokens"): my dark bar-star and pressed rules used fixed colours. Now they use `--dk-dot`, `--dk-index` and
  the allowed `rgba(255,255,255,.15)`.

## Decisions (no one to ask)
- When filtered, all written reviews go in one list rather than per-source groups, so the "(N)" in the header
  matches the bar.
- The header count is the number of reviews shown. Ours come in pages: with ours alone (histogram) a bar can say 10
  while only the loaded 3 are listed; More Reviews stays under the filtered list to load more.
- Pressed is a grey wash rather than blue, so it doesn't look like the selected row.

## Not verified
- The concept artifact (claude.ai/artifact/8C3kGPXR766CK7Mk24KQMj) is a JavaScript shell, and curl only gets the
  loader page. It needs a browser with a signed-in session, so the right phone's exact spacing and colours come from
  the brief alone.
- Not run on a phone (iPhone 7) or against live sources: the task didn't ask for the phone, and no backend ran here.
  Only the harness was drawn.
- With pages of ours ("More Reviews"), the bars counted from reviews don't update when a page loads. That only
  happens when there are several sources (no histogram) and ours has more than one page.
- `:active` can stay on a row after a touch turns into a scroll on iOS. app.js's `.is-pressed` (its PRESSABLE list)
  doesn't include `.store-bar`, and app.js isn't in this task's files.
- Dark theme render not taken (CSS rules added for stars and pressed state only).
