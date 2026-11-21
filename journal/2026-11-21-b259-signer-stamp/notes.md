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
  "Signed by an older iFizBox: re-sign it so its data stays its own". When the signature also ends inside the window
  (or has ended) the line gives both, the end first ("Signature ends today · signed by an older iFizBox"). The pill keeps showing the days left (green when outside the window). No
  current stamp in the answer (an older shell): only expiry counts, as before.

## Decisions

- iFizBox's own record is never listed for its signer: re-signing it is an update of the app itself, offered on its
  own (Settings' own re-sign); an extra self-update prompt in Changes for this would surprise.
- Apps signed by 0.18.1+ builds before this change also carry no stamp, so they are listed once too. One extra
  re-sign; there is no way to tell them from 0.18.0's records (same record shape).
- The dylib hash is kept only for apps that got the fix, so a new dylib build doesn't ask every app for a re-sign.
- The website: its install records (core/installed.js appRecord) keep no signature at all (no expiry; Installed shows
  "?" for them) and the website has no Needs Re-sign list, so there is nothing to stamp or compare there yet. Filed
  as F342 (website records keep expiry and a website signer stamp, fed to needsResign/olderSigner) instead of adding
  an unused constant to websign.js.
- My IPAs' cached signed copy had to learn the stamp too: Re-sign of an app recorded from My IPAs signs through
  `signIfNeeded`, which reuses the cached copy when certificate and options match, so without it the re-sign the
  row asks for would reinstall the same old signature.
- Spec review: kept the Library change (above), the iFizBox exemption and the hash-only-when-injected design (both
  above); fixed the row of an app both expiring and older-signed so it names both reasons.

## Tests

- `web/app/core/signing.test.js`: needsResign with 0.18.0's record shape (no stamp), version 0, another dylib hash,
  current stamps (not listed), skip by upgrade, no current stamp, no expiry, iFizBox's own record.
- `native/sign/tests/main.swift`: stamp staleness, record round-trip and JSON, 0.18.0's record decoding with no
  stamp, My IPAs refusing an unstamped signed copy, the group fix hash on a signed app (only apps with the fix go
  stale on a new dylib).

## On the iPhone 15 Pro

Built this branch (native/build.sh, 0.18.2 build 3459) and installed it over the Lite app with `ui-15.sh install`
(data kept). Its signing.installed records were written by earlier builds (no stamp). Changes showed Needs Re-sign
with B246 Test, R54 Test, Probe and R51Test, each with a green "341 days"/"363 days" pill and "Signed by an older
iFizBox: re-sign it so its dat…" (truncated to one line); the tab badge counted them (5 with OpenTennis's upgrade).
Shot: ref/15/screens/b259-changes.png (ref/, not committed).

## Not verified

- Re-signing one of those apps on the phone and seeing it leave the list: not run. It would re-sign and reinstall a
  test app on the shared phone (a long Signing Server/This iPhone run); the Swift test covers that a fresh signature
  carries the current stamp, and the node test that a current stamp isn't listed.
- The combined line for an app both expiring and older-signed ("Signature ends today · signed by an older iFizBox")
  was changed after the phone build; covered by the node test only.
- The installed build on the 15 Pro is this branch's, not main's, until the next install there.
