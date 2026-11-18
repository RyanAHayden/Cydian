# F103: the missing Sileo depiction views

## What I did
- `web/app/screens/depiction.js`: added `DepictionRatingView`, `DepictionReviewView`, `DepictionWebView` and
  `DepictionMinVersionForceView`, plus two exported helpers, `stars(rating)` and `webUrl(url)`.
  - Rating: five grey stars, with the dark ones clipped to rating/5 (a CSS width on an overlay). Values are clamped
    to 0-5 and there's an aria-label.
  - Review: one grouped cell (the `.table.grouped` look: #f7f7f7, 1px edge, 9.5px corners). The title and stars
    share a row, then "by author", then the markdown, run through the same safe parser (or the `useRawFormat`
    sanitiser).
  - WebView: `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy">`, sized
    `min(100%, width px)` at the width/height aspect, honouring alignment. Only http(s) URLs are allowed.
  - MinVersionForce: renders its `view`. Cydian draws every class it knows, so there's no version to check.
- `web/app/packages.css`: `.dep-rating`, `.dep-stars(-fill)`, `.dep-review*`, `.dep-web`.
- `web/app/screens/depiction.test.js` (new): 5 tests over a fake DOM.

## Decision: http WebView on the site
The brief says "http through the proxy". But the worker's `/api/fetch` only passes images, text/plain and JSON.
Everything else comes back as `application/octet-stream` under `Content-Security-Policy: default-src 'none';
sandbox` (worker/src/index.js `PASS`, `SAFE`). An iframe pointed there would be blank or start a download.
Opening HTML up in the proxy would make cydian.dev an open web proxy, and the worker isn't on this task's file list
anyway. So `webUrl` sends http through `backend.assetUrl`, as asked. When that changes the URL (the site's proxy),
the view becomes a "Web Page" link row that opens the original URL in a new tab. In the app `assetUrl` is the
identity, so an http page loads straight in the iframe.

## Tried / failed
Nothing failed. There is no star artwork in `ref/teehanlax/ios6` or the 4S artwork, so the stars are drawn as SVG
data URIs (#666 filled, #c4c4c4 empty).

## Checked
- `node --test web/app/screens/depiction.test.js`: 5 pass.
- A headless Chromium render at 3x of rating 3.5, a review and MinVersionForce: the half star clips cleanly and
  the review cell matches the grouped table.

## Not verified
- The star colours compared with the real iOS 6 App Store: neither the kit nor the 4S artwork has stars, and the
  task didn't say to touch the 4S.
- Dark mode look of the review cell and stars: not rendered. The cell uses the theme variables; the star colours
  are fixed greys.
- An actual iframe load (https page, and http in the native app under ATS): the headless check used no network
  page, and there's no native build here. Whether WKWebView's ATS lets an http iframe load in the app is unchecked.
- Real-world depiction JSON with these classes from live repos: no samples fetched (none on disk; the network isn't
  part of this task).
