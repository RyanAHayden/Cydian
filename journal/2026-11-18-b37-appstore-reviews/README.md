# B37: AltStore app pages show the App Store's rating and reviews

## What I did
- `core/applookup.js mergeDetails`: the App Store's `rating`/`ratingCount` (and `trackViewUrl`) are taken whenever the
  store answered, whatever `need` is. Developer, category, screenshots, description, version and minimumOs stay
  gated on `need === "full"` as before. The old test that pinned `link.rating === null` encoded the bug; it now
  expects 4.58.
- `screens/altstore.js`: the page now always looks the app up, `need === "none"` included. Before, an app whose source
  gave screenshots, a developer and its own page (a GitHub link) never asked the App Store, so it could never show a
  rating either. That is the "any apps" half of the user's report. `need` still decides which details are merged.
  The extra lookups cost little: the Worker caches each one at the edge for a day and the device caches it for a week.
- Written reviews: `parseLookup` keeps `trackId`. New in `core/applookup.js`: `storeTrackId` (falls back to the
  id in `trackViewUrl` for lookups cached before this change), `reviewsFeedUrl`, `workerReviewsUrl`,
  `parseStoreReviews` (Apple's customer-reviews RSS JSON to plain-text reviews, newest first, at most 50; it skips the
  app-itself entry older feeds put first and handles a single entry that comes as an object) and `storeReviews`
  (kept in memory for a day; `[]` on failure).
- Worker: `GET /api/appreviews?id=&country=` (`appReviews` in `worker/src/index.js`), built like `/api/applookup`.
  It only accepts a numeric id and a 2-letter country, caches at the edge for a day (node.mjs uses its
  `LOOKUP_CACHE`), sends Apple's JSON back as it came, caps the answer at 512 KiB and does not cache failures. It
  doesn't go through the generic `/api/fetch` proxy: the brief says "like the lookup", and a dedicated, cached
  endpoint means Apple gets one request per app a day instead of one per visitor.
- `core/reviews.js mergeReviews`: `appStore.reviews` becomes a third list, `appStoreReviews`, with its own label
  `appStoreLabel: "App Store Reviews"`. The footer names the App Store when it gives either a rating or reviews.
  `reviews` (ours + the depiction's) is unchanged, so More Reviews paging is not affected.
- `screens/reviews.js`: draws the App Store's reviews as their own "App Store Reviews" group after ours and the
  depiction's, through `reviewCell`'s default renderer (textContent).
- `screens/altstore.js`: the Reviews tab's `appStore` is `withStoreReviews(ratingReady, looked)`. The feed is only
  requested when the tab opens. The website asks the Worker; the app asks Apple directly via `backend.text`, like the
  lookup does.

## Checked
- Unit tests: mergeDetails with need "link", the feed parser, URLs, the cache, `withStoreReviews`, mergeReviews'
  third list, the tab's group (it draws text, not markup) and the Worker endpoint (cache, bad input, failures).
- Real data, fetched 2026-11-18: Apple's lookup and RSS for Delta (com.rileytestut.Delta, id 1048524688) run
  through `parseLookup` → `mergeDetails(…, "link")` → `parseStoreReviews` → `mergeReviews` give a rating of 4.75751
  from 28,385 ratings and 50 reviews, newest first. The ratings card shows that as 4.8 (asserted in the tab test).

## Not verified
- I didn't look at the page in a browser or on a phone: no visual check of Delta's header stars, Rating tile and
  Reviews tab. The unattended run has no browser session or screen lock for this, so the check stops at the
  data and fake-DOM tests above.
- The jailbreak app path (`backend.text(reviewsFeedUrl(…))` asking itunes.apple.com directly) was not run on the
  iPhone 7. The task doesn't call for touching the phone. The lookup already uses the same path to the same host.
- The deployed Worker was not exercised: no deploy, by the run's rules. Its route is covered by `worker/test.mjs`.
