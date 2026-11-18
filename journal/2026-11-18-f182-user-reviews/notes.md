# F182: user reviews, read and written in the app and on the site

## What was built
- **Worker** `worker/src/reviews.js`, routed from `src/index.js`:
  - `GET /reviews/<id>?page=&per=` returns the average, the per-star histogram, the newest reviews first (only those with a
    title or text) with paging (`more`), and `mine` when `X-Review-Token` is sent.
  - `POST /reviews/<id>` takes `{stars, title≤80, name≤30, text≤2000, version≤64}`. A second post from the same device replaces the first: same id and first date, and its reports reset.
  - `POST /reviews/<id>/<rid>/report` counts each reporter once (the token, or the address hash without one). At `REPORT_HIDE` (3) reports the review is hidden from the list and the counts. Its author still sees it, marked hidden.
  - `DELETE /reviews/<id>/<rid>` needs `Authorization: Bearer $REVIEWS_ADMIN`. If the secret isn't set, the route always answers 403.
  - Abuse limits: per address 6 writes a minute (the `REVIEW_RATE_LIMIT` binding, or memory without it), per token 4 a minute (memory), and per address 40 a day (`REVIEW_DAILY`, counted in D1).
  - Text handling: control characters and bidi overrides are stripped, caps count characters (not bytes), and text is stored plain and drawn with textContent.
  - Privacy: tokens and addresses are kept only as salted SHA-256 hashes (`REVIEWS_SALT`).
  - With no `REVIEWS` binding, GET answers `{enabled:false}` and writes answer 503.
- **Storage: D1**, not KV. D1 is on the Workers Free plan (5 GB, 100k rows written a day), so nothing here costs money and there was nothing to ask. KV's 1,000 free writes a day would be too few. The tables are created on first use (`CREATE TABLE IF NOT EXISTS`), so a deploy has no migration step. `wrangler.toml` binds `REVIEWS` without a database_id, so wrangler provisions it, the same way it does HOSTED.
- `worker/src/d1-sqlite.js` is the D1 API over `node:sqlite`, used by the tests. The Worker never imports it.
- **Client** `web/app/core/reviews.js`:
  - `checkDraft`
  - `deviceToken`: tries the native `reviews.token.get/set` (Keychain), else localStorage `cydian.reviewToken`
  - `reviewsApi`: anything that isn't the server's JSON, such as the SPA's index.html, reads as "off"
  - `mergeReviews`: a count-weighted average across ours, the depiction and the App Store. The bars show only when ours are the only counted source.
  - Both backends expose it as `backend.reviews`: the site uses its own origin, the app uses `ACCOUNT_BASE`, through the same CORS route Account uses.
- **UI** `web/app/screens/reviews.js` + `reviews.css`:
  - The Reviews tab (the APT package page in browse.js, and AltStore apps in altstore.js with the App Store's rating merged in).
  - Tap to Rate (it keeps your written words and changes only the stars), Write a Review / Edit Your Review, More Reviews…, and Report (asks first; shown only on other people's reviews written here).
  - The Write a Review sheet per the concept (Cancel / Send, stars, Title, Name, Review, the note).
  - The header stars and the Rating tile now include reviews written here.

## Decisions (unattended run)
- The concept's "Report a Problem" button was left out: there is no backend for it, and the per-review Report is what the brief asked for.
- A written review needs a title (the App Store's rule). Stars alone need nothing.
- A review's id is in the route rather than its index, so Report and delete point at one row.
- Replacing a review resets its reports. Tokens cost nothing to make, so keeping the reports wouldn't stop anyone.
- I didn't edit `wrangler.ifizbox.toml` (the production deploy): it's outside the task's files, and an unverified binding there could break publishing. Filed **F185** to enable it and set the secret. Also filed **F186** (the native Keychain handlers) and **F187** (reviews in worker/node.mjs).

## Tried / failed
- My first reviews.js had literal U+2028 characters inside the regex: the editor turned ` ` escapes into the characters, and the module wouldn't parse. I re-escaped them.

## Checked
- `node worker/test.mjs` covers: post, replace on a second post, caps, the per-address, per-token and per-day limits, the binding path, report hiding (once per reporter, never your own), owner delete with and without the secret, and no DB.
- `node --test web/app`, including the new `core/reviews.test.js` and `screens/reviews.test.js`. These cover the sheet, the merged list, Tap to Rate, Report, paging, and the disabled server.
- A 3x headless Chromium render of the tab and the sheet against a fake API. It looks like the concept.

## Not verified
- Live D1 on Cloudflare: auto-provisioning on deploy and the D1 batch semantics outside the node:sqlite shim. No Cloudflare access from this run.
- ifizbox.com itself: reviews stay off there until F185.
- The jailbreak and sideload builds on a phone (the iPhone 7): this task didn't call for the device. The app's CORS fetch to cydian.dev is assumed to work because Account already uses it.
- The dark theme render of the new controls: only the light theme was rendered.
