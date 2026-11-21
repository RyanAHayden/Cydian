# B262: Download IPA shows no progress

User (2026-11-21): "the current download IPA has no progress in log or MB/s".

## What was there

- The shell's IPA download (`Sideload.download`: URLSession `Download`, or `PlainDownload` for plain http) sent only
  a fraction (`{phase: "downloading", progress}`, throttled to whole percents) and one Log line at the end
  ("Downloaded 43 MB in 1.1 s, 38.9 MB/s", B223). The run page's row said "Downloading 12.0 of 48.0 MB" only when
  the queue had a listed size, else "Downloading 42%"; no MB/s anywhere, and nothing in the Log while it ran.
- The copy to iOS (B246) logs its MB/s through `IDevice.ilog` (device log), not the page.
- The website's fetch (`signing/browser.js downloadIpa`) set "Downloading 40%" on its progress page, no MB/s.

## What changed

- `native/sign/DownloadMeter.swift`: once a second, the bytes, total and the last second's rate; its Log line
  "Downloaded 120.3 of 312.0 MB (38%), 21.4 MB/s" ("Downloaded 120.3 MB, 21.4 MB/s" without a length) and the
  event `{phase: "downloading", progress, bytes, total, rate}`. Bytes going backwards (a redirect, the http
  fallback after the https twin) start the count again.
- `Download` and `PlainDownload` take an optional `bytes: (written, expected)` callback (passed on through
  PlainDownload's redirects); `Sideload.download` passes it; `Sideload.downloadTicks(log:event:)` turns it into the
  meter's Log line and event. Wired into `signing.prepare` (the run page, SignAhead), `signing.install` (the single
  progress page) and Re-sign All (Log line only: its events carry index/count).
- Page: `signing/queue.js` passes `{bytes, total, rate}` as progress's 4th argument; `core/apprun.js` keeps them
  on the row and `rowStatus` says "Downloading 30.0 of 300.0 MB, 21.4 MB/s" (the shell's total before the queue's
  listed size; "Downloading 5.0 MB, 2.5 MB/s" without a length). The Log gets the shell's lines as grey lines.
- Website: `downloadIpa` gets `onBytes(n, total)`; `signInBrowser` runs `core/downloadmeter.js` (the same words in
  JS) and puts the MB/s on the label ("Downloading 38%, 21.4 MB/s") and the line in the page's Log once a second.

## Tests

- `native/sign/tests/sideload/main.swift` "Download progress once a second (B262)" (in `native/test_sideload.py`).
- `web/app/core/downloadmeter.test.js` (meter, words, the row), `web/app/download-speed.test.js` (queue events,
  downloadIpa's onBytes, the site's label and Log lines).

## Phone check (iPhone 15 Pro)

(below)

## Not verified

(below)
