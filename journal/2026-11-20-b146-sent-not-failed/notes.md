# B146: Signing Server route ends "Sent to iOS", not "Failed: iOS didn't install it"

User's iPhone 18 Pro (iOS 27.0.1): Unbound installed fine (appstored "Install complete"), but the row said
"Failed: iOS didn't install it". Sideload.swift's watch saw progress, then `Workspace.isInstalled` answered false;
`lostSight` is false when progress was seen and iFizBox stayed in front, so the reply was `installed: false`.

## What I did

- `web/app/signing-client.js` `openPrepared`: on the prompt route, signing.progress's reply maps to
  `installed: true` or `null`; `false` survives only with `dismissed: true` (iOS never asked for the IPA, still
  "Failed: iOS didn't download it"). `null` makes core/apprun.js end the row Done/unsure, logging "Sent X to iOS"
  (and B136's recordWhen then waits for iOS before recording it). The This iPhone route returns before this code,
  so installd's real `false` still fails the row. core/apprun.js needed no change.
- `native/Sources/Sideload.swift` `watch()`: when it ends with `false`, an NSLog line with progress seen, last %,
  away, elapsed seconds and a fresh isInstalled read, so a later fix can make Installed real.
- New test `web/app/signing-client-sent.test.js` (a new file rather than edits to the shared test files, to keep
  merges clean): prompt false -> installed+unsure, "Sent Alpha to iOS"; prompt true -> Installed; dismissed ->
  Failed (didn't download); This iPhone false -> Failed: iOS didn't install it.

## Not verified

- The Swift change isn't compiled here (Linux, no iOS SDK in this slot); it uses only names already in scope in
  `watch()` and the same NSLog/`%%` pattern as `progress()`. The device builds in the gate/CI will compile it.
- Not tried on the iPhone 18 Pro (the user's phone, not reachable from here).
