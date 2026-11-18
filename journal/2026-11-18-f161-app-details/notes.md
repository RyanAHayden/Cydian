# F161: App details and the right links on IPA app pages

## What I did
- `web/app/core/applookup.js` (new, pure): iTunes Search API URLs, `parseLookup`, `lookupNeed` (none / link / full),
  `mergeDetails` (source fields win), `pageLinks` (never two rows to one page), `ownPageLinks`, `shortText`, and
  `lookupApp` (localStorage cache per country + bundle ID for a week; "not found" is cached too, a failed fetch isn't).
- `worker/src/index.js`: `GET /api/applookup?bundleId=&country=` → Apple's lookup, first result only, `Cache-Control:
  public, max-age=86400`, kept in `caches.default` (or `env.LOOKUP_CACHE`). Bad input never reaches Apple; Apple
  down or non-JSON → 502, not cached. `worker/node.mjs` hands it an in-memory day-long `LOOKUP_CACHE`.
- `screens/altstore.js renderApp`: only when the page opens, `storeLookup` (website → Worker, app → Apple via
  `backend.text`; country from `navigator.language`, else us). It fills in: the developer under the name (when the
  source names none), App Store stars + rating count in the header (F103's `stars()`), the App Store screenshots in
  F122's gallery when the source has none (before GitHub README pictures), "From the App Store" under the source's
  text (cut to its first paragraphs, with a More row), and Details rows (Developer, Category from the genre when the
  source gives no category, App Store Version, App Store Requires).
- Links: 1) the app's own page (its website/GitHub, else the App Store page), 2) the source's page in Cydian,
  3) "Source Website" (from the source JSON's `website`) only when no row above already goes there.

## Decisions (unattended, so I wrote down why)
- "No lookup when the source gives screenshots and developer, except for the App Store link": read as no lookup at
  all when the app also has its own GitHub/website link; with screenshots + developer and no link of its own, a
  lookup is still made but only `trackViewUrl` is used (`lookupNeed` = "link").
- The source's website is never taken as one app's page, even when the app's entry names it: it shows once, as
  "Source Website". So does any page under the source JSON's own URL.
- Why AppTesters showed "both the same github link": its IPAs are released in `apptesters-org/AppTesters_Repo`
  (and icons + ESign's `down` field point there), so F122's `appGithub` took that repo as each app's GitHub. Now a
  repo found only through a download is the app's page only when it's named for the app (the same rule F122 uses for
  the source's own repo), or when the app's link fields point at the repo page itself (not a release/raw file).
  I did this in applookup.js (`ownPageLinks`) rather than changing `core/previews.js` (not on this task's files);
  package pages (browse.js `linksGroup`) still use F122's rule as before.
- Apple's lookup does answer with `Access-Control-Allow-Origin: *` (checked with curl), but the brief asks for the
  Worker route with edge caching, so the website goes through it.

## Tried / failed
- Clamping the App Store text with `-webkit-line-clamp` cut a line in half (the text keeps its newlines, pre-wrap):
  replaced with `shortText` (whole paragraphs up to ~320 chars) and a More row.
- First render still showed the AppTesters GitHub row: the entry's `down` field holds the release URL. Fixed (above).

## Checked
- `node --test web/app/core/applookup.test.js` (9 tests), `node worker/test.mjs` (applookup with a fixture fetcher
  and cache).
- `worker/node.mjs` against real Apple: `/api/applookup?bundleId=com.atebits.Tweetie2&country=gb` answered, the
  second call came from the in-memory cache (4 ms).
- Rendered the website in headless Chromium (CDP from a scratch script, node.mjs on localhost) with the real
  AppTesters source, FlightTracker (com.iaftt.flightplusfree): developer Impala Studios, 291,131 ratings with stars,
  App Store screenshots, "From the App Store" with More, Details with Travel / 8.8.5 / iOS 16.0, Links App Store →
  AppTesters IPA Repo → Source Website (apptesters.org).

## Not verified
- The jailbreak app and the sideload app (native `backend.text` straight to itunes.apple.com): not run on a phone;
  the task didn't call for the iPhone 7, and the code path is covered only by the storeLookup unit test with a fake backend.
- Cloudflare's `caches.default` on the deployed Worker: only the code path with a fake cache and node.mjs's cache
  were run; nothing was deployed (never publish beyond git).
- The More row and the App Store link opening: not tapped in the headless render, only drawn.
- The region in WKWebView: assumed `navigator.language` carries the device region (e.g. en-GB); not checked on a device.
