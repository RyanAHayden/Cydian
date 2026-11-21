# C41: screens/ read the bridge through native.js

## What I did

- Every direct `globalThis.ifizboxNative` read in `web/app/screens/*.js` (23 files, 48 reads: the screens/ total of the old ALLOWED) now goes through
  `web/app/native.js`: `nativeBridge()` where the code wants the bridge object (default parameters, truthiness
  checks for "app vs site", `?.call?.(…)` calls), `hasNativeCall()` where it asked "can the bridge take calls"
  (`extras.js` `native()`, `tweaks.js` `bridge()`, `apprun.js` `screenAwake`).
- Same semantics: `nativeBridge()` reads the global at call time, and every replaced read was already evaluated at
  call time (default parameters, function bodies), so tests that set or clear the global between cases see the
  same thing.
- `native-reads.test.js`: every `screens/` line is gone from ALLOWED , so every screen's ceiling is now 0 (a file not
  listed may not read the global at all). The spec review flagged an extra "screens/ stay at zero" test I had
  added as unasked; it repeated what the unlisted-file rule already enforces, so I took it out.
- Nothing moved to `getBackend()`: each read was a bridge call or an "is this the app" check the backend doesn't
  wrap one-for-one; a straight accessor swap keeps the change mechanical and the merge risk low.

## Tried and failed

none

## Not verified

- On-device behaviour (iPhone 7 / 15 / 4S): not run. The change is an accessor swap with identical call-time
  semantics, and `node --test web/app` plus `tools/check.sh` cover the screens; no phone run was worth the slot.
