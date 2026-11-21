# B261: plain-http apt repos (BigBoss) are added and refreshed

## What refused http

Two different things, one per build:

- **The app (both builds): App Transport Security.** `net.fetch` and `net.packages` (Apt.swift `Apt.get`) used
  URLSession, and the app has no ATS exception, so every http repo failed. Seen live on the iPhone 15 (Lite app,
  Web Inspector, `ifizboxNative.call("net.fetch", {url: "http://apt.thebigboss.org/…/dists/stable/Release"})`):
  `network: The resource could not be loaded because the App Transport Security policy requires the use of a secure
  connection.` That is the "blocked for not being https" the user saw. (Icons, .deb downloads and IPAs already went
  around ATS: net.icon's PlainGet, PlainDownload.)
- **The site: not http at all.** `/api/fetch` passes http (checked live: 200 for BigBoss's Release). But BigBoss's
  URL as people type it, `http://apt.thebigboss.org/repofiles/cydia/`, has no flat repo at it: it is a
  `deb … stable main` repo, so Add Source said Did Not Find Repository (after This Source Is Not Secure).

## What changed

- `native/Sources/PlainFetch.swift` (new): an http GET into memory over Network.framework's plain TCP (not under
  ATS), decoded by `share/HTTPStream.swift`; same answer as the URLSession path (status, lower-cased headers, body),
  redirects followed (5; to https back to `Apt.get`), `Apt.maxBody` cap, 30 s idle / 120 s total timeout.
- `native/Sources/Apt.swift` `Apt.get`: http URLs go to `PlainFetch.get`. ATS stays on app-wide (no
  NSAllowsArbitraryLoads), so nothing else in the app reaches http. The SSRF rules are the Worker's and unchanged
  (the app fetches from the phone itself, as before).
- `web/app/core/sources.js` `verifySource`: when nothing flat is found, a Release under `dists/stable/` turns the
  URL into that dist source (`stableDistSource` → `verifyDistSource`); otherwise not_repository as before.
  Checked live through ifizbox.com's proxy: BigBoss's URL adds as `deb:http://apt.thebigboss.org/repofiles/cydia/:stable`
  with 235 arm64 packages.
- Kept: This Source Is Not Secure (F220) still asks once before an http source is added. It lets the source in
  (Add), so it isn't a refusal; dropping a feature the user asked for earlier on an unclear reading seemed wrong.
  Plain-http IPAs keep their Install Anyway prompt (untouched).
- Package downloads: the jailbreak app installs through apt, which reads http itself; Lite's .deb fetch
  (`share.debFetch`) already used PlainDownload for http. Nothing to change there.

## Tests

`web/app/core/sources-http.test.js`: a flat http source added through `addSecure` over a fake proxy (alert, then
http itself fetched) and refreshed; BigBoss's flat URL added as its stable dist and refreshed; nothing anywhere is
still not_repository; the Swift wiring (Apt.get → PlainFetch, no NSAllowsArbitraryLoads) as text.
`core/sources.test.js`'s not-a-repo call list gained the two `dists/stable/` probes.

## Tried

- My first cdp server on port 9333 couldn't bind (another slot's was there) and my eval went to theirs and timed
  out; a server of my own on 9347 worked.

## Not verified

- **PlainFetch on a phone.** The gate builds it (both native builds), but I didn't install a new build on the
  iPhone 15 or the 7: other slots overwrite the 7's .deb and the 15 was on another task's Pairing page. So BigBoss
  added and refreshed in the app (either build) is unchecked on a device; the ATS refusal it fixes was seen live.
- **https → http redirects** in `Apt.get`'s URLSession path still fail under ATS (rare for repos; none seen). Not
  changed.
- The site's Add Source was run against the live proxy from node (verifySource with createHttpBackend), not by
  tapping in a browser; the deployed site gets the fallback only after release.
