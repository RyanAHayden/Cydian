# C5: backend-native.js refreshSources honours { filter }

## What I did
- `nativeSourceCalls().refreshSources(onEach, { filter })` now filters the merged list (apt's sources + device-only
  records) before reading each source's count/Release from apt's lists and saving it; `onEach` and the result hold
  only the kept sources. Same shape as `core/sources.js` sourceCalls (`filter ?? (() => true)`).
- Kept unfiltered on purpose: `migrateAdded()` (moving device-only records into cydian.sources is cheap and any
  refresh should do it) and `apt-get update` (the helper's `update` has no per-source form; apt refreshes all lists
  in one run anyway, so the filter only saves the per-source reads and store writes).
- Test: `refreshSources { filter } reads back and saves only the sources it keeps (C5)` in backend-native.test.js.

## Tried that failed
- none

## Not verified
- On the iPhone 7 with the real helper: the task doesn't touch the phone, and the change is JS-only over the same
  bridge calls the fake native already exercises.
