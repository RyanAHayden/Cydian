# C30: narrow the bridge surface (native.js accessor)

## What I did
- `web/app/native.js`: the one accessor outside backend-native.js, `nativeBridge()` (the bridge or undefined) and
  `hasNativeCall(native?)`. Both read `globalThis.ifizboxNative` at call time, so tests that set/clear the global
  between cases keep working (default params like `native = nativeBridge()` evaluate per call, as before).
- `web/app/screens/installed.js`: all 9 direct reads go through it (7 default params, `keptIpa`'s guard,
  `runAppAction`). Behaviour unchanged.
- `web/app/native-reads.test.js`: walks the shipped modules (not tests, helpers, vendor/), counts
  `globalThis.ifizboxNative` / `globalThis["ifizboxNative"]` per file, and fails when a file exceeds its ceiling in
  ALLOWED or reads it without a line. backend-native.js and native.js are exempt. Ceilings only (not exact), so a
  parallel task that removes reads doesn't break the gate; the test header says to lower lines, never raise them.
  Also checks the total, that installed.js has 0 and imports native.js, and the accessor's call-time reads.

## Numbers
Direct reads outside backend-native.js (per match, not per line): 102 before, 93 after; files 44 -> 43
(the brief's "43 files" counted by `grep -l` before native.js existed; `grep -c` counts lines, which undercounts
extras.js, tweaks.js and settings-store.js by one each, with two reads on one line — the test counts matches).

## Tried and failed
- First allowlist came from `grep -c` (lines); the test caught 3 files with two reads on a line. Fixed the ceilings.

## Choice
Routed through native.js, not getBackend(): the 9 reads are bridge calls the backend interface doesn't wrap
(signing.forget/openApp, dates, malware scan) and default-param injection points tests use. Moving them into the
backend is a bigger interface change, out of scope for a low cleanup; the remaining 42 files are left for follow-ups.

## Follow-ups filed
- C41: the remaining screens/*. C42 (after C41, both edit the allowlist): everything outside screens/.

## Not verified
- On-device (iPhone 7 / sideload IPA): not run, the change is a pure refactor of how the same global is read; the
  unit tests for installed.js cover the paths.
