# B137: the IPA queue's run on This iPhone says Installing, not Tap Install

## Cause
`createAppRun`'s `startInstall` puts the row in state `asking` (phase null) before `openPrepared` knows the route.
`chooseRoute` (idevice.status, and possibly the LocalDevVPN alert) runs in that gap, so on the This iPhone (local)
route the row said "Tap Install on the iOS prompt" and the bottom status "Tap Install for X (n of m)", though
installd never shows an iOS prompt. The row also took the tap as a reprompt.

## Fix
- `core/apprun.js`: `createAppRun({ local(row) })`. `startInstall` stores `row.local`. `promptUp(row)` = not local, or
  phase `asking` (the install went through the Signing Server after all, so iOS's prompt really is up). On an `asking`
  row with no prompt up, `rowStatus` says "Installing", `runStatus` says "Installing X (n of m)", and `reprompt` answers false.
- `screens/apprun.js`: passes `lanes.local` on to `createAppRun` (one line).
- `screens/queue.js`: `runAppQueueRun`'s phone lanes add `local: () => storedRoute() === "iphone"`.
- Rows without the hint (the website, older tests) keep their old words.

## Checks
- `node --test` on core/apprun.test.js (2 new B137 tests: per-route rowStatus/runStatus, the server fallback, the
  reprompt guard), screens/apprun.test.js, install-route-wait.test.js and install-here-progress.test.js: 49 pass.
- Chromium with the fake native bridge (`capture.mjs` copied from B129, plus fakes for signing.prepare,
  idevice.status delayed 3 s, and signing.open sending copying/installing). Ran `runAppQueueRun` with two jobs on the
  iphone route. The statuses it saw:
  Signing… → "Installing || Installing Alpha (1 of 2)" (the route wait) → Copying to iPhone N% → Installing N% →
  Installed, then the same for Beta → "2 installed". No "Tap Install" anywhere. Screenshot: `route-wait.png`.
  Run: `node capture.mjs http://127.0.0.1:8137/ . script.json --mode sideload`, with web/app served on 8137.

## Not verified
- Real phone (iPhone 18 Pro / sideload build on This iPhone): the task asked only for the fake bridge, and no phone was in scope.
- I did not record a "before" run in Chromium for comparison. The cause comes from reading the code, and the node test fails on the old code's words.
