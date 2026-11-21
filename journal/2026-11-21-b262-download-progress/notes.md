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
- Install's single progress page (`signing/route.js`, signing.install) keeps the last MB/s on its label between the
  shell's ticks ("Downloading 42%, 21.4 MB/s"); added after the spec review pointed out it only got the Log line.
- `rateText` lives in `core/signing.js` (already in app.js's startup closure): a first version imported it from the
  new `core/downloadmeter.js` and pushed the startup closure to 117 modules, which `module-graph.test.js` refuses.

The progress page's Log already merges grey lines that differ only in their numbers (`screens/progress.js`), so the
once-a-second line is one line updating in place, not a scroll of lines.

## Tests

- `native/sign/tests/sideload/main.swift` "Download progress once a second (B262)" (in `native/test_sideload.py`).
- `web/app/core/downloadmeter.test.js` (meter, words, the row), `web/app/download-speed.test.js` (queue events,
  Install's label, downloadIpa's onBytes, the site's label and Log lines).
- `tools/check.sh` passed (one skip: no PowerShell, as before).

## Phone check (iPhone 15 Pro, iOS 27)

This branch's Lite IPA (`make -C native ipa`) installed with `tools/ui-15.sh install`. Test app: the rig's WDA.ipa
re-identified as `com.ryha.b262big` ("Big Download") with a 320 MB random file, 341 MB in all, in an AltStore
source served by a throttled stdlib server (about 6 MB/s) behind `tailscale serve --https=8462`, added with
`ifizbox://add?url=…`, then Install, Confirm (the sign-ahead run page).

- `log-15pro.png`: the Log during the download: "Downloaded 104.6 of 325.8 MB (32%), 6.0 MB/s", one line updating
  (a later shot read "258.1 of 325.8 MB (79%), 6.0 MB/s").
- `row-15pro.png`: the Apps row: "Downloading 184.3 of 325.8 MB, 6.0 MB/s".

My stop on the row came after the download had finished and the install had begun: the row said Cancelled, but iOS
installed the app anyway (the shell's Cancel lets iOS finish an install once it has the whole IPA, as documented in
`Sideload.cancel`). I uninstalled `com.ryha.b262big` (`ios uninstall`), deleted the B262 Test source and cleared
the queue. The signed record "Big Download" is still listed under Installed on the phone (other tests' records are
there too); it is harmless.

## Not verified

- The website's label and Log lines on a real browser: tested in node only (`download-speed.test.js`), not on
  ifizbox.com with a big IPA, as the site isn't deployed from a task branch.
- Install's single progress page (signing.install) on the phone: unit-tested only; the phone run used the run page.
- Plain http downloads (`PlainDownload`, Install Anyway) and a server sending no Content-Length on the phone: the
  "Downloaded N MB, X MB/s" form without a total is unit-tested only.
- Re-sign All's Log lines on the phone: not run (unit path shared with signing.prepare).
- The jailbreak app's IPA installs go through the root helper's own download (`ipa-install.js`), which this task
  did not touch.
