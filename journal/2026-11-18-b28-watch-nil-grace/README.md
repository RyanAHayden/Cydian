# B28: signing.progress waits out short nil reads

## What I did
- `native/Sources/Sideload.swift` `SignBridge.watch`: once progress was seen, a nil
  `installProgressForBundleID` no longer answers at once. It remembers when the nil reads started (reset by any
  progress read) and answers `isInstalled` only after 6 s of nil in a row (`nilGrace`), or 1.5 s when the last
  progress reached 100% (`nilGraceDone`, so a finished install still answers quickly).
- Why time alone and not "isInstalled plus no progress": for an update (and a new app's placeholder) isInstalled is
  true all through the install, so it says nothing; the length of the gap is the only signal.
- The 15-minute cap and the 45 s "never saw progress" rule are unchanged. signing-sheet.js `followInstall` (B27)
  still re-calls on a mid-install end; it is now just the second line of defence.

## Tried and failed
- nothing.

## Not verified
- On the iPhone 7 with a big IPA: not done. `watch` only runs in the sideload build (the jailbreak app refuses
  signing.progress), the iPhone 7 runs the jailbreak .deb, and docs/iphone7.md has no sideload set-up (signing
  identity, the sideload IPA installed); setting that up, and driving its screen, is a device session of its own
  for an unattended run. Whether 6 s covers the longest gap iOS leaves on a big IPA is therefore not measured; if
  it doesn't, raise `nilGrace` (followInstall's re-call still covers it meanwhile).
- The Swift change is only compiled by the gate's native build (where the toolchain is set up), not run.
