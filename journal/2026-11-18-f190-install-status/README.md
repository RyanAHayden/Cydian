# F190: website install shows what iOS is doing after "Installing"

## What I did
- `worker/src/index.js`: iOS's own requests on an upload's link are marked per token: `manifest` (GET
  manifest.plist answered 200), `started` (app.ipa's body begins streaming, GET only; HEAD isn't a download) and
  `finished` (the chunk holding the file's last byte is handed over; a Range that stops short isn't the end).
  `GET /sign/up/<token>/status` -> `{ manifest, started, finished }` (always 200 for a 48-hex token, so an old
  Worker's 404 tells the website it has no status).
- Each mark is read first and written only once: at most 3 KV writes an install (the test counts them, also
  across a re-asked manifest, a Range and a second download).
- `web/app/signing-client.js`: `watchInstall(token, hud, …)` polls the status every 500 ms (user's note on the
  task: faster than the brief's 1.5 s), up to EARLY_WINDOW, and steps the log through `installSteps`:
  "Waiting for iOS…" -> "iOS is downloading <app>…" -> "Downloaded. iOS is installing it: watch the Home Screen
  (Safari can't see the install itself)." then done. Every step shows at least 400 ms (`STATUS_MIN_SHOW`), so a
  fast install still reads as steps. No download begun 60 s in: "iOS didn't ask for the app. Tap Install again."
  and the page finishes on a Retry button that opens the itms link from the tap (an alert with Install on a HUD
  without `finish`). The page closed by the user stops the polling.
- `signInBrowser` awaits only the watcher's first look, then returns true as before; a Worker without `/status` (or
  no answer at the first look) ends the page on "Installing", exactly the old behaviour, so the existing tests and
  an un-deployed Worker keep working.
- Tests: `worker/test.mjs` "worker ios status"; `web/app/signing-client-status.test.js` (fake clock and status
  sequence: steps, 500 ms polling, 0.4 s minimum per step, not-asked + Retry, no /status, closed page, the token
  handed over by signInBrowser).

## Decisions
- The marks live in their own KV key (`up.<token>.ios`), not inside the upload's metadata as the brief said: the
  website's reservation, size POST and done each rewrite that metadata whole (from a copy read earlier), so a mark
  iOS made in between (the manifest is fetched at the Install tap, before the reservation lands) would be lost.
  Same write count.
- The "didn't ask" timeout is on `started` (no download 60 s after the upload finished), not only on `manifest`:
  in the early flow iOS already fetched the manifest at the tap, so the real "iOS gave up" case is the download
  never beginning. Its held GET gets the body as soon as done lands, so a live iOS starts within seconds.
- Between manifest and started the log already says "downloading" (as the brief orders the steps).
- After Retry the page stays finished; it doesn't start watching again (the user sees iOS's own prompt).
- `web/app/websign-job.js` was on the task's file list but needed no change (it runs inside the signing Web
  Worker, nowhere near the install).

## Not verified
- On a real iPhone/Safari against the deployed Worker: not deployed from a task (never publish beyond git), and no
  phone run here. Untested in particular: that KV reads at the browser's edge see the phone's marks promptly (both
  come from the same device, so the same Cloudflare location, where KV writes show at once; another location can
  lag up to ~60 s) and that a missing key's read isn't cached long enough to hide the first mark.
- That the last-chunk `finished` write inside the stream's pull (through FixedLengthStream) runs on Cloudflare
  before the response ends: the node test covers the logic only.
- The progress page's look of the Retry button with this label: no browser render checked.
