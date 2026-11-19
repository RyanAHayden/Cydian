# F260: Website Install opens iOS's prompt by itself

## What was wrong

The early link (iOS's prompt opened inside Install's tap) needs `identity.passwordOk === true`
(`signing-client.js expectedBundleId`). Many working certificates never got there:

- `core/signing.js checkP12Password` answers `null` for a `.p12` it can't read (BER octet string, public-key
  integrity mode, an unknown MAC hash);
- the account sync (`screens/account.js`) saves `passwordOk: null`;
- older identities have no `passwordOk`.

All of those went to the Ready to Install alert, a second tap.

## What I did

- `websign-job.js runPasswordCheck(createZsign, { p12, password, profile })`: zsign WebAssembly with `-k -p -m`
  and an empty folder as input. zsign's `main()` loads the profile and certificate (`ZSignAsset::Init`) before it
  looks at the app, so the output says which: "Can't find app folder" → true, "Can't load p12" with OpenSSL's
  "mac verify failure" → false, anything else (damaged file, crash) → null. No WASM rebuild needed.
  `passwordVerdict(lines)` is the reading part.
- `signing-worker.js`: `{ check: "password", … }` runs that instead of a sign.
- `signing-client.js`: `checkPasswordInWorker`, `confirmPassword` (re-reads the identity before saving, so a
  password typed or a file picked meanwhile wins; caches the last boolean answer per p12+profile+password so
  Settings' recheck saves don't rerun zsign; with no password saved, "" that opens it is saved as `""`, one that
  doesn't is not saved as wrong), `confirmSoon` (300 ms debounce, one at a time, no-op without `Worker`).
  `saveIdentity` calls `confirmSoon` whenever the saved identity `needsConfirm` (p12 + profile + passwordOk
  neither true nor false). The module's load-time read calls it too. `PASSWORD_EVENT` (`ifizbox:password`) fires
  after a save.
- `screens/settings.js` (not on the task's file list, two small additions: an import line and a listener in
  `init`): on `ifizbox:password`, repaint the Password row of connected Signing pages with `showPasswordState`,
  without a redraw (which would take the focus from someone typing). Settings > Signing lives in settings.js, not
  `screens/signing.js` (the walkthrough helpers), so that file needed nothing.
- `docs/signing.md`: a paragraph under the early link.
- Tests: `web/app/password-confirm.test.js` (verdict parsing, fake and real zsign on test.p12 / test-nopass.p12 /
  test-legacy.p12, the Worker job's shape, confirmPassword's save, cache, races and unknowns, and expectedBundleId
  turning on after the confirmation).

## The remaining fallbacks (the second half of the brief)

- **Bundle ID not known at the tap**: the website can't predict the signed ID with Keep Bundle IDs unless the
  caller passes the app's own ID. browse.js (AltStore apps, the case the user hit) already passes
  `bundleIdentifier`, and My IPAs' kept files pass theirs. Bulk updates and re-signs (`installed.js manageInstall`,
  `queue.js`'s site path) pass only url and name: filed as **F262** (low), since those files are outside this task.
- **Another ID out of zsign / EARLY_WINDOW passed**: iOS already has a manifest for the reserved ID, or has
  stopped retrying. Opening a new itms link needs a user gesture in Safari (F121: opened by script, Safari asked
  "Open this page in iTunes?" or refused it), so the Ready to Install tap stays for these. With Keep Bundle IDs
  the job signs as `appBundleId`, so the "another ID" case is rare for source apps.
- A password check still running at the tap (page just loaded, zsign WASM not yet fetched) falls back once; the
  next Install goes straight through.

## Tried, didn't work

- `chromium --headless --dump-dom --virtual-time-budget` returned before the Worker answered. Drove Chromium over
  CDP with a scratch script instead (scratchpad, not committed).

## Checked

- `node --test web/app/password-confirm.test.js`: 9/9.
- Real headless Chromium, the real Worker and zsign.wasm over a local server: right → true, wrong → false, legacy
  RC2 .p12 → true; `saveIdentity({ …, passwordOk: null })` became `passwordOk: true` on its own, one
  `ifizbox:password` event.

## Not verified

- **On the iPhone 7 web app (Install of an AltStore app goes straight to iOS's prompt)**: the web app on the 7
  loads ifizbox.com, which gets this change only after the runner merges and publishes it, and a session may
  not publish. Check after publishing: on the 7's home-screen web app, with a certificate synced or seeded (or
  any certificate whose Password row showed the plain lock), open Settings > Signing once (the Password row should
  turn to the green check by itself), then Install an AltStore app: iOS's prompt with no Ready to Install alert.
- Safari's WebAssembly memory for the extra short zsign module on an iPhone 7: tiny (no IPA in it), and it ends
  with the Worker, but not measured on the phone.
- The Settings Password row repaint itself (`showPasswordState` on the event) was not seen in a browser; the
  event firing was.
