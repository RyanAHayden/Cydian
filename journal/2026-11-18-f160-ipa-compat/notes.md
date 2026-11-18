# F160: compatibility for apps whose source gives no iOS range

## What was done

- **Worker `GET /api/ipainfo?url=`** (`worker/src/index.js` `ipaInfo`, `rangeReader`; reader in the new
  `worker/src/ipainfo.js`): reads `Payload/*.app/Info.plist` with Range requests only: `bytes=0-3` (checks
  `PK\3\4`, gives the size), the last ~64 KB (end record, zip64 locator and record), the central directory when it
  isn't in that tail, then the one entry (local header + data, again if the local extra field is longer). Inflates
  with `DecompressionStream("deflate-raw")`, parses binary (bplist00) or XML plists. Answers
  `{minOSVersion, deviceFamily, bundleId, version}` or `{code, error}`. Same URL rule as `/api/fetch` (`httpUrl`),
  redirects followed, 20 s a read, at most 6 reads, central directory up to 16 MB, Info.plist up to 4 MB.
  Cached at the edge (keyed by URL) 30 days; errors that won't change (`no_range`, `not_zip`, `no_plist`,
  `bad_plist`, `too_large`, `not_found`, status 422) a day; `upstream` (502) not at all. `node.mjs` gets it through
  the router and uses its existing in-memory `LOOKUP_CACHE`.
- **`web/app/core/ipainfo.js`** (new): `needsCheck`, `ipaInfoUrl`, `textMinOS` (the "iOS 15+" / "Requires iOS 14.0"
  fallback), `withIpaInfo` (fills minOSVersion/deviceFamily where the source has none, sets `ipaChecked`),
  `savedInfo`/`allSaved` (localStorage `cydian.ipainfo.<downloadURL>`), `checkIpa` (Worker → App Store's
  minimumOsVersion (F161) → description text; the IPA's value wins; in-flight dedupe and a 2-at-a-time queue),
  `createQueue`.
- **`core/compat.js`**: new status/code `unchecked` (an app with no stated range, an http(s) downloadURL and no
  `ipaChecked`): label "Not Checked", never incompatible, mark `unchecked`. New reason `ipad` (UIDeviceFamily
  without 1): "Not for iPhone", red. `core/altstore.js appStanza` now carries `downloadURL` on the stanza.
- **`core/catalog.js`**: `setIpaInfo(map)` op; rows of IPA apps are judged with `withIpaInfo` (also Search's
  exact-match reason). **`web/app/catalog.js`**: sends `allSaved(localStorage)` with the first question, then
  `catalog.setIpaInfo({url: info})` sends one new result and notifies listeners.
- **App page** (`screens/altstore.js renderApp`): a saved result judges the badge at once; otherwise one
  `ipaCheck` (site: own `/api/ipainfo`; app: `https://cydian.dev/api/ipainfo`, the Worker answers CORS `*`), then
  the badge, Works on My Phone and Details' Compatibility row ("iOS 15.0 or later (from the app)", "App Store",
  "from its description", "iPad only", "Not known") are redrawn, and the catalog gets the result. Lists never ask.
- **Marks**: `packages.css` grey outlined ? (`data-mark="unchecked"`), the filled grey ? now means checked but
  unknown; `browse.js` label for it; `.pkg-compat[data-compat="ipad"]` red.
- Tests: `worker/test.mjs` builds a plain zip (deflated XML plist pushed out of the tail by a 100 KB entry) and a
  zip64 one (binary plist from Python's plistlib, sizes and offset in the 0x0001 extra field), served by a fake
  server that answers Range like GitHub (and 501 to suffix ranges); no-Range server, no Info.plist, not a zip, 404,
  503, offline, cache hits. `web/app/core/ipainfo.test.js`: text fallback, merge into compat, iPad-only, storage
  and expiry, checkIpa flows, queue, where the site/app ask, catalog re-judging and filtering.

## Decisions (unattended run)

- Parser lives in `worker/src/ipainfo.js`, not shared with `web/app/core/`: the client only needs the Worker's
  JSON, and the Worker importing from `web/app/` would be a new cross-directory dependency for the deploy.
- Native app asks cydian.dev's Worker too instead of reading the IPA itself (the brief says "may"): no native
  Range-capable fetch exists in the bridge yet, and the edge cache serves everyone.
- iPad-only applies whatever device is browsing (Cydian is for iPhones; the device record has no iPhone/iPad field).
- `runsOn` (altstore.js) is not fed the IPA's value: it picks the candidate version when the source loads, before
  any page was opened; the result reaches the candidate's row through compat instead (and with Works on My Phone's
  filter on, a red row drops out of lists as any incompatible one). An older version that would run is not picked
  in its place.
- Kept on the device: IPA answers for good (a downloadURL's file doesn't change in practice); "checked, unknown"
  30 days; a fallback found while the Worker was down, 1 day; a network failure with nothing found, not kept.

## Tried and failed

- First reader used a suffix range (`bytes=-65678`): GitHub's release asset store (release-assets.githubusercontent.com)
  answers **501** to suffix ranges. Now `bytes=0-3` first for the size (as tools/ipa-plist-probe.py did); the test
  server refuses suffix ranges so this can't come back.

## Checked live

- `ipaInfo` against `https://github.com/RyanAHayden/Cydian/releases/download/v0.4.0/Cydian.ipa`:
  `{"minOSVersion":"15.0","deviceFamily":[1],"bundleId":"com.ryha.cydian","version":"0.4.0"}`; through
  `node worker/node.mjs` too (0.38 s, then 1 ms from its cache).

## Not verified

- Deployed on Cloudflare (wrangler bundling of the new `src/ipainfo.js`, `caches.default` with a 422 answer,
  DecompressionStream in workerd): no deploy from a task run; wrangler isn't installed here.
- The app page and the outlined mark were not looked at in a browser or on a phone (no screenshot taken): the
  SVG reuses the filled ?'s path with the fill dropped, unchecked at 3x zoom.
- An AppTesters IPA or other big real-world zip64 IPA: only Cydian's own IPA was read live; zip64 is covered by the
  fixture only.
- The jailbreak/sideload app's fetch to https://cydian.dev from the WKWebView (CORS `*` should allow it): no phone
  used (the task doesn't name one).
