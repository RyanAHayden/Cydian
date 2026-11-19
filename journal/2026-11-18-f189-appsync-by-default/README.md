# F189: AppSync Unified by default (jailbreak build)

## What changed

- `web/app/core/appsync.js` (new, pure): AppSync's id, akemi's source (`https://cydia.akemi.ai/`) and its page,
  `appSyncInstalled(dpkg status)` (by `ai.akemi.appsyncunified`, or a package that Provides `appsync` /
  `net.angelxwind.appsyncunified`, as 116.0's control does), `sameSource(uri)` (akemi's repo however it was typed),
  `appSyncFailure(step)` (the short fallback: one plain sentence per step, never apt's raw error; Try Again, Open
  Source, OK) and the Confirm note.
- `web/app/screens/ipa-install.js`: `openIpaInstall` now goes through `installWithAppSync`:
  1. `ensureAppSync`: only where the backend has apt's queue and dpkg's status (the jailbreak build). AppSync in
     dpkg: straight on. Else akemi's source is added when missing ("Verifying URL" HUD), refreshed on its own
     ("Reloading Data", F99's `refreshSources({ filter })`), looked up in the catalog under that source's key (a
     package of the same id from another source doesn't count: akemi only, never Canister's copies), and queued.
     The Confirm sheet opens as for any queued package: AppSync Unified under Install, plus a footer saying the IPA
     installs right after it.
  2. The queue run that installs it closes its console at once (its output is in Console Logs) and the IPA's own
     console opens. If the run also had other packages, their finish button (a respring) comes first and the IPA
     follows when that console closes.
  3. Failure (add, refresh, not listed, the apt run) → `appSyncFallback`: e.g. "Couldn't refresh cydia.akemi.ai."
     with Try Again (the whole thing again), Open Source (`https://cydia.akemi.ai/?page/ai.akemi.appsyncunified`, to
     install by hand) and OK. Confirm's Cancel (or the run's Cancel) stops quietly.
  4. installd still refusing the app (`no_adhoc`) gets the same short alert ("iOS refused the app even though
     AppSync Unified is installed.", or "This app needs AppSync Unified, which isn't installed." where the backend
     couldn't tell); the old "Needs AppSync Unified" alert with its text is gone from that path.
- `web/app/screens/queue.js`: `whenQueueRuns(id, { note })` / `takeWaiters(ids)`: a promise for what became of a
  queued package (installed / failed / cancelled), the note drawn under Modifications, and the hand-off in
  `runConsole` (waiters are taken out before the run's own `clearAll`, so they aren't read as cancelled).
- `web/app/core/ipainstall.js`: `NO_ADHOC_HELP` is one line (the ldid and sign-it-yourself options are dropped);
  `IPA_FOOTER` says AppSync Unified comes from cydia.akemi.ai with the first IPA.
- `native/share/Share.swift`: a shared .ipa in the jailbreak build always routes to the helper now (it used to be
  refused up front with neither AppSync nor ldid, "Can't Install IPAs"); the app installs AppSync first. Test and
  `native/share/README.md` updated.
- Tests: `web/app/core/appsync.test.js`, `web/app/screens/appsync.test.js` (steps, order, each failure step, the
  fallback loop, Try Again closing the old console, the waiters), `ipa-install.test.js` for the one-line help.

## The source: why akemi's

The user's follow-up says only ever akemi's source. Upstream's GitHub release 116.0 (akemin-dayo/AppSync, commit
235aca6) ships `ai.akemi.appsyncunified_116.0_iphoneos-arm64…deb` beside the iphoneos-arm one, so the rootless build
exists (the iPhone 7 runs that very .deb: `Architecture: iphoneos-arm64`, `Version: 116.0`, its `Depiction` and
`Homepage` point at cydia.akemi.ai). The repo itself couldn't be read today (below).

## Tried / found

- `https://cydia.akemi.ai/` (Release, Packages*, `/`) answered **Cloudflare 522** from the desktop and from the
  iPhone 7 all day (as it did for R21 earlier today). So the auto-install can't succeed right now on any phone: the
  add step's verification fetch fails and the fallback says "Couldn't add cydia.akemi.ai.".
- Decision: no fallback to a mirror or GitHub's .deb, per the user's "only ever use akemi's source".

- First phone run: the add step showed Add Source's "Verifying URL" HUD for **about 4 minutes** (19:34 → 19:38)
  before the fallback. Each 522 takes ~19 s (measured with curl) and Add Source's check makes several requests
  (Packages variants, Release/InRelease, magic files), plus the shell's own tries. The user saw it and asked what
  the spinner was and why it was so bad. Fix: one HUD for the whole step, "Getting AppSync Unified" (the user tapped
  Install on an IPA, not Add Source), and time limits (`APPSYNC_LIMITS`: add 25 s, refresh 2 min). Past the limit
  the fallback shows; the request is left running in the background. Test added
  (`ensureAppSync: a source that never answers…`).

## On the iPhone 7 (lock F189; build 0.9.7-1415 from this branch)

Screens are in `ref/7/screens/` (gitignored, main checkout):
- Removed AppSync (`apt-get remove ai.akemi.appsyncunified`; its postrm reloads installd), then opened
  `ifizbox://install?url=…opentennis-ios.ipa&name=opentennis`: `f189-1-install-alert.png` (Install IPA alert),
  `f189-2-after-install-tap.png` (old build: "Verifying URL"), `f189-old-run-end.png` (old build's fallback after
  ~4 min).
- After the fix: `f189-5-getting-hud.png` ("Getting AppSync Unified"), `f189-6-fallback-fast.png` (19:39:07 tap →
  fallback shown by 19:39:38): "Needs AppSync Unified / Couldn't add cydia.akemi.ai." with Try Again, Open Source and
  OK. No ldid or sign-it-yourself text. OK closed it; no akemi source was left in `sources.list.d`.
- Put AppSync back from the GitHub 116.0 iphoneos-arm64 .deb (`apt-get install`); `dpkg -s` says installed.
- With AppSync present the flow goes straight to the IPA console (no HUD, no Confirm), but installd refuses this IPA:
  "Application is missing the application-identifier entitlement" (`f189-7-present-install.png`), the R21 problem
  in docs/iphone7.md. That's the helper's job (fakesign with that entitlement), not AppSync: filed **B59**. The
  alert there is the ordinary "Install Failed" one (code `install`, not `no_adhoc`).

## Not verified

- **The happy path on the phone** (akemi's source added and refreshed, Confirm listing AppSync Unified under
  Install with the note, the queue run handing over to the IPA console, opentennis opening): cydia.akemi.ai answered
  Cloudflare 522 all session, from the desktop and the phone, and the user said to use only akemi's source. The
  steps, their order, the Confirm note and the hand-off are covered by `web/app/screens/appsync.test.js` with fakes;
  the queue-run hand-off in `runConsole` (closing the console and resolving the waiter) has no DOM test.
- **opentennis opening**: it can't install even with AppSync until B59 (missing application-identifier entitlement).
- **That akemi's repo itself serves the iphoneos-arm64 build** today: unreachable. Upstream's GitHub release has
  it, and the installed package's Depiction/Homepage point at cydia.akemi.ai.
- The Confirm footer's look (the note under Modifications) on a real screen: never drawn, because the source never
  answered.
- "Cannot Comply" for AppSync (e.g. its `firmware (<= 18.2)` cap on iOS 26): Cancel there reads as cancelled, so no
  fallback alert is shown. The sheet itself explains apt's refusal.
- The share-sheet route change (a jailbreak .ipa no longer refused up front) passed the Swift share tests in the
  gate; not tried by sharing a file on the phone.
