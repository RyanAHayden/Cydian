# F253: UDID from a configuration profile on the website

## What I did

- `worker/src/udid.js` (new), wired in `worker/src/index.js` before the other routes: `POST /sign/udid` (challenge
  kept in `HOSTED` KV for `TTL`), `GET /sign/udid/<c>/udid.mobileconfig` (Profile Service, DeviceAttributes UDID/
  PRODUCT/VERSION, Challenge, URL = the answer route), `POST /sign/udid/<c>/answer` (reads `<?xml … </plist>` out of
  the CMS, no crypto; stores `{udid, product, version}`; 301 to the done page), `GET /sign/udid/<c>/done` (go back;
  also writes Safari's own `ifizbox.udid`), `GET /sign/udid/<c>` (poll).
- Put everything under `/sign/udid` rather than `/udid`: `/sign/*` is already in `run_worker_first` in both wrangler
  files, so no config change (a new prefix would have been served `index.html` by the SPA fallback).
- Only a challenge this Worker handed out is accepted (404 otherwise), and the plist's `CHALLENGE`, when present, must
  match: a stranger can't fill KV or overwrite another visit. Body capped at 64 KB. UDID must be hex/dashes, PRODUCT
  and VERSION a short safe charset (they go into the done page's HTML and inline script).
- Website (`web/app/screens/signing.js`): `startUdid`, `pollUdid`, `watchUdid` (2 s interval plus visibilitychange),
  `storedUdid`/`saveUdid`, `udidFindRows` (pure), `canFindUdid` (iPhone/iPad UA, iPadOS by touch points),
  `udidFindText` (says the profile shows "Not Verified" and that's fine). `settings.js` `drawSiteSigning` checks the
  profile against the stored UDID and adds Find This iPhone's UDID (or "Waiting") under This iPhone while the check
  is unknown.
- Tests: `worker/test.mjs` (start, profile contents, CMS-wrapped answer, wrong/unknown challenge, too large, poll,
  done page), `web/app/screens/signing-udid.test.js` (new).
- docs/signing.md: "The website's UDID, through a configuration profile".

## What failed on the way

- `screens/signing.test.js` forbids the word `mobileconfig` in signing.js/settings.js (left from the old local-trust
  profile): reworded my comment to "configuration profile".

## Not verified

- **The whole flow on a real iPhone**: it needs the Worker deployed to an https origin (iOS posts only to the URL in
  the profile), and deploying is publishing, which this task doesn't ask for. So these are unchecked: that iOS
  accepts the unsigned profile with "Not Verified" and posts to `/sign/udid/<c>/answer`; that it follows the 301 into
  Safari; how the Home Screen web app reacts to `location.href` pointing at the profile (it may open Safari or an
  in-app sheet); and the exact CMS bytes (the test wraps a plist in made-up DER-ish bytes; the reader only looks for
  `<?xml…</plist>`, as Feather's CertificateReader does).
- Whether iOS sends `CHALLENGE` in the answer exactly as given (Apple's docs say it does); if it ever didn't, the
  answer is still accepted (`challenge: null` passes, the URL's challenge decides).
- KV's eventual consistency across colos: the poll may see "waiting" for up to ~60 s after the answer lands at
  another edge. Polling keeps going until the TTL, so it only delays.
