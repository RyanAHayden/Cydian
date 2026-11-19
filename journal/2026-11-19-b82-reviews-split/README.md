# B82 App pages: This Build and App Store reviews, never averaged

## Which concept
The plan line as handed to this run still described the earlier one-long-scroll layout (group headers "This Build",
"App Store", "App Store Reviews", one footer). Its suffix said "user approved the toggle concept (see note)", but the
unblock commit (52f2fb4) replaced the note itself. The note is in the commit before (a8e1121): "SUPERSEDES the scroll
layout above: the user picked a TOGGLE". I built the toggle note's version, because that is what the user approved.

## What changed
- `core/reviews.js`: `mergeReviews` no longer takes the App Store (ours + depiction only, so tweak pages work as
  before). New `buildRating(ours)`, `storeRating(appStore)` (marked `onAppStore`), `pageRating({ ours, appStore })`
  (ours when anyone rated here, else Apple's) and `compactCount` (1.2K, 50M).
- `screens/storepage.js`: header count reads "(50,123,456) on the App Store" for Apple's rating; Rating tile sub
  "App Store"; `ratingsCard(..., { build: true })` has no group header and the lines "Rated by people using this
  build. Bars from N ratings." / "Nobody has rated this build yet. Be the first."; new `appStoreCard` (bold 28px
  average, storeStars, "N Ratings", no bars, note row "For <name> by <seller> on the App Store, not this build.").
- `screens/reviews.js`: `reviewsTab({ build: true, appStore })`. With an App Store match there's a small segmented
  control on top (packages.css `.segmented/.segment`, the depiction's): "This Build (N)" | "App Store (50M)", always
  opening on This Build. The App Store view is drawn the first time it's chosen, and only then are Apple's written
  reviews fetched (once, kept across a redraw after Tap to Rate). They show 10 at a time behind "More Reviews…".
  Switching fades the view in (opacity only). The star filter and bars count only ours. With nobody rated, This Build
  has the footer "Ratings here are for this build only. The App Store tab has the original app's." With no match,
  there's no toggle and no footer.
- `screens/altstore.js`: `appStoreTab(ratingReady, looked)` gives the tab Apple's rating, `trackName`, seller and a
  lazy `reviews()`. The header stars and Rating tile are set once both ratings are known, through `pageRating`, so
  they don't flip from Apple's to ours.
- `reviews.css`: toggle margins, view hidden, App Store card.

## Decisions (no one to ask)
- With 0 ratings here the toggle reads "This Build", not "This Build (0)".
- A match without an App Store rating still gets the toggle: its card shows "—" / "No Ratings".
- Apple's feed gives up to 50 reviews in one go, so "More Reviews…" reveals the next 10 from that list.
- `withStoreReviews` in altstore.js isn't used by the page any more. I left it because `core/applookup.test.js` (not
  in this task's files) tests it.

## Checks
- `node --test web/app`: 1619 pass. New or updated tests: a 50M App Store count doesn't move our average (core,
  altstore-reviews, screens); bars and the star filter count only ours; the toggle is hidden without a match; Apple's
  reviews aren't fetched until the toggle and only once (also after a redraw); header/tile wording; both cards.
- 3x headless Chromium renders of `harness.html` (real CSS and modules, made-up data), compared with the concept:
  `rated-build.png`, `rated-appstore.png`, `none-build.png`, `none-details.png` (tile "4.6 / App Store", header
  "(50,123,456) on the App Store"), `rated-details.png`, `nomatch-build.png`. The first App Store shot was caught
  mid-fade, so the harness now finishes animations before the shot.
- `tools/check.sh`: run by `agent-runner done`.

## Not verified
- Dark theme render: not taken. The new CSS uses only theme tokens (`--text`, `--subtitle`). The `.segmented`
  control has no dark rules of its own (true before this task too).
- The real app page (renderApp) in a browser against the live Worker and Apple's feed: harness only, no network
  lookups from this sandbox.
- iPhone 7: not touched (the task didn't ask).
