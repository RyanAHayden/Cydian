# B259: apps signed before a signer change are offered a re-sign

## What changed

- `native/sign/SignerStamp.swift` (new): `SignerStamp { version, groupFix }`. `SignerStamp.version` (now 1) is
  bumped by hand when the signer's output changes in a way installed apps should get. `groupFix` is the first 16 hex
  digits of the SHA-256 of the group fix dylib, set only when the app got the fix. `SignerStamp.now` is this build's
  stamp (the bundled dylib's hash). A stamp is stale when its version is lower, or when it names a dylib other than
  the current one; with no current dylib, the hash can't make it stale.
- `IPASigner` puts the injected dylib's hash in `SignedApp.groupFix`; `SignedApp.stamp` is what records keep.
- `SignedRecord.signer` (optional, so 0.18.0's records decode with nil) is written by all three record makers:
  `Sideload.signAndOpen` (install and Re-sign), `SignAhead.sign` (the IPA queue's Confirm run) and My IPAs (from the
  signed copy's own stamp). The record's JSON carries `signer`.
- `signing.installed` answers `signer: SignerStamp.now.json` beside the records.
- My IPAs' signed copy (`IPALibrary.Signed`) keeps its stamp too, and `signed()` no longer hands out a copy with no
  stamp or a stale one: otherwise Install from My IPAs would put the old signature back on (it reuses the cached copy
  whenever certificate and options match).
- `web/app/core/signing.js`: `olderSigner(record, current)` and `needsResign` list a record with no stamp, an older
  version or another dylib under Needs Re-sign, with `olderSigner: true` and the line
  "Signed by an older iFizBox: re-sign it so its data stays its own". The expiry text wins when the signature also
  ends inside the window (it says more). The pill keeps showing the days left (green when outside the window). No
  current stamp in the answer (an older shell): only expiry counts, as before.

## Decisions

- iFizBox's own record is never listed for its signer: re-signing it is an update of the app itself, offered on its
  own (Settings' own re-sign); an extra self-update prompt in Changes for this would surprise.
- Apps signed by 0.18.1+ builds before this change also carry no stamp, so they are listed once too. One extra
  re-sign; there is no way to tell them from 0.18.0's records (same record shape).
- The dylib hash is kept only for apps that got the fix, so a new dylib build doesn't ask every app for a re-sign.
- The website: its install records (core/installed.js appRecord) keep no signature at all (no expiry; Installed shows
  "?" for them) and the website has no Needs Re-sign list, so there is nothing to stamp or compare there yet. Filed
  as a follow-up (see below) instead of adding an unused constant to websign.js.

## Tests

- `web/app/core/signing.test.js`: needsResign with 0.18.0's record shape (no stamp), version 0, another dylib hash,
  current stamps (not listed), skip by upgrade, no current stamp, no expiry, iFizBox's own record.
- `native/sign/tests/main.swift`: stamp staleness, record round-trip and JSON, 0.18.0's record decoding with no
  stamp, My IPAs refusing an unstamped signed copy, the group fix hash on a signed app (only apps with the fix go
  stale on a new dylib).

## Not verified

- On the iPhone 15 Pro, an app signed by 0.18.0's record shape showing under Needs Re-sign: not run. The 15 Pro's
  ui-15.sh run needs a Lite build installed and a record written by the old build; the node test feeds needsResign
  that exact record shape (the Swift test decodes it with no stamp and the JSON leaves `signer` out), which is
  the whole path from signing.installed to the row. Filed with the website follow-up? No: recorded here only.
