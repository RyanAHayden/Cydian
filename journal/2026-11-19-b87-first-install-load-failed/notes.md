# B87: Install on the Website fails the first time with "Load failed"

## Which fetch fails

The error the user saw was Safari's bare text, "Load failed". Looking at what can reach signInBrowser's alert without
being re-worded narrows it down:

- The `/api/fetch` request, every `/sign/upload` request and the reservation all go through `retrying`. If the request
  itself fails, the user sees our own words ("The app couldn't be downloaded: no connection to the server.", "...
  couldn't be uploaded ..."), never the bare text. So the error came after an answer had started.
- The zsign worker and wasm load fail with other words. A failed `import()` of zsign.js is "Importing a module script
  failed." A worker script that doesn't load goes through `w.onerror` ("The signer stopped: ..."). Emscripten's wasm
  load tries streaming, then fetch, then a sync XHR, and only then aborts with "Aborted(...). Build with -sASSERTIONS
  ...". None of these is a bare "Load failed".
- What is left is reading a body after the headers came: `reader.read()` / `arrayBuffer()` in `downloadIpa`, or
  `res.json()` on an upload answer (a few bytes). This is the IPA's body. An earlier commit (8e92f75) hit the same
  bare "Load failed" when the Worker's old 30 s timer cut a 40 MB IPA in the middle.

## Measurements against the live Worker (ifizbox.com, 2026-11-19, curl)

- `/api/fetch?kind=ipa` answers **without Content-Length**. ipaFetch sets it, but Cloudflare drops it from a body
  streamed through a JS TransformStream (the size cap). So the browser can't tell a body that was cut from a whole one:
  `total` was always 0 in downloadIpa.
- A cold read at phone speed (`--limit-rate 400K`) of Cowabunga 8.1.3 (21,862,959 bytes, a release file not in the
  edge cache yet) ended **cleanly after 163,840 bytes** with HTTP 200 and curl exit 0. The same file read slowly once
  it was warm came through whole (53 s). A fast cold read of it also came through whole.
- 8 more cold reads came through whole: UTM 89.8 MB and Feather 14 MB fast; LiveContainer+SideStore 3.8.0, 3.7.0
  and 3.6.1, and Cowabunga 10.3.0–10.3.2, all at 400 KB/s. So the cold path breaks now and then, not every time. The
  warm path (Cloudflare's copy, RELEASE_CACHE) didn't break once.

Together: the first Install of an app streams it cold from GitHub through the Worker. When that stream breaks, the
browser either gets an error part way (Safari: "Load failed" from the reader) or a clean but short body that nothing
checked. The retry finds the file in Cloudflare's cache and works. This matches "fails the first time, then works".

## Fix

- worker/src/index.js ipaFetch: the length also goes in `X-IPA-Length` (exposed to CORS), which Cloudflare keeps. An
  upstream that ends short of its Content-Length now errors the stream (`flush`) instead of ending it cleanly.
- web/app/signing-client.js downloadIpa: the body is checked against Content-Length or X-IPA-Length. A body that
  breaks off (read error) or comes up short is fetched again from the start, **once**, with the reason in a comment:
  the second request comes from the edge copy the first one started. A second break gets its own words (`CUT_TEXT`),
  not "Load failed". Cancel during a broken read isn't retried. A reader cancel on a stream that already errored no
  longer leaves an unhandled rejection; the new Cancel test found this.
- The download progress now has a total (X-IPA-Length), so it counts up again instead of showing nothing.

## Tests

- web/app/download-cut.test.js: a broken body and a short body are each fetched once more; only one more try, then
  CUT_TEXT; Cancel isn't retried; X-IPA-Length gives the progress its total; signInBrowser's first Install with a
  broken download goes on to sign and upload.
- worker/test.mjs: X-IPA-Length and its CORS expose header; an upstream that stops at 5 of 8 bytes errors the body.

## Tried that didn't work

- Getting a cold break to happen on demand: only 1 of 9 cold slow reads broke, so I couldn't make it happen when I
  wanted to. The fix is tested with fake broken and short bodies instead.

## Not verified

- **A fresh Safari tab or private window on an iPhone, first Install succeeding**: not done. The website's Install
  needs a signing certificate and profile in Safari, and there's none on hand (the wildcard .p12 still waits on Ian,
  see the memory notes). Also, an unattended run doesn't drive a phone's screen when the task doesn't name the phone.
  Playwright's WebKit is on this machine, but without a certificate it stops at "No Certificate" before any
  download.
- **The fixed Worker on the live site**: not deployed from here; the runner publishes after the merge. The
  measurements above are from the Worker as it is now. Once it's live, check `curl -sD- -o /dev/null
  'https://ifizbox.com/api/fetch?kind=ipa&url=…'` shows `x-ipa-length`.
- **Whether Safari's reader really throws on a stream the Worker errors in flush**: I expect a reset stream, which
  makes the reader fail. If Safari ended it cleanly instead, the length check catches it the same way.
