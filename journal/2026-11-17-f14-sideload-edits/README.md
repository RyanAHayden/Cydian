# F14: sideload installs on the phone, what I6 left open

I6 had already built the core differently from F14's brief: its own Swift signer (`native/sign/`), the `.p12` in the
Keychain, and installs through a CA made on the phone. F14 built on that, as its note asked. The details are in
docs/signing.md, "Before and around signing (F14)".

## What I did

- **The user's edits while signing** (`native/sign/SignOptions.swift`, hooks in `IPASigner.swift`): name
  (Info.plist and each `.lproj/InfoPlist.strings` that names it, with a small old-style `.strings` parser for UTF-8
  and UTF-16), bundle ID (the profile still decides: an explicit profile keeps its own ID; extensions follow), icon
  (written as `CydianIcon60x60@2x/@3x.png`, `CFBundleIconName` dropped), and leaving extensions out.
- **arm64e fix-up** (`Arm64e` in SignOptions.swift): I read Feather's `SigningHandler.swift` and `MachOUtils.m` on
  GitHub. The fix is LiveContainer's (Apache-2.0): set `CPU_SUBTYPE_LIB64` on a fat file's old-ABI arm64e slice, in
  both headers. Rewritten in Swift, applied before signing to every Mach-O.
- **Inspector** (`native/sign/Inspect.swift`): entitlements from the current signature, privacy permissions,
  extensions, icon path, size, and the entitlements the profile can't give (`missing`). Also `Profile.kind` and
  `Profile.signatureExpiry`.
- **OCSP, reminder, records** (`native/sign/CertCheck.swift`): OCSP request and answer parsing (no signature check,
  as Feather), the reminder's date and words, and the Codable record of signed apps for Re-sign All.
- **Phone half** (`native/Sources/Sideload.swift`): `signing.inspect`, a new `signing.install` (it replaces I6's
  version in SignBridge.swift: edits, keep-alive, a record), `signing.progress` (LSApplicationWorkspace, looked up at
  run time), `signing.installed`, `signing.forget`, `signing.resignAll`, `signing.checkCertificate`,
  `signing.remind` (UNUserNotificationCenter), silent-audio `KeepAlive`. `signing.status` also gets `profile.kind`,
  `identity.signatureExpires` and `identity.revocation`.
- **Tests**: `native/test_sideload.py` and `native/sign/tests/sideload/main.swift`, separate from test_sign.py so
  the two tasks' test files don't collide in merges.
- Filed **F68** for the page's side: the web app doesn't call any native `signing.*` yet, so nobody can see the
  sheet, Re-sign All or the revocation warning until it lands.

## Decisions

- **Progress is a separate call.** The bridge drops a call's stream once it answers (`native/bridge.js`), and
  `signing.install` answers as soon as iOS has the link. Holding the answer back until the install ends would hang
  the page whenever the user taps Cancel on iOS's sheet, and Cydian can't see that tap. So `signing.progress
  {bundleId}` streams progress and gives up after 45 s with no progress.
- **Re-sign All downloads again.** "No IPA library" in the brief, so each app is fetched from its recorded URL. An
  expired URL fails that app, and the reply says so.
- **Not built, on purpose:** backloop.dev, api.palera.in and Zsign-Package (I6 replaced them), so there are no
  tests for pack expiry or genPlist URL encoding. The manifest plist and itms link tests already exist in I6's suite.
- The reminder only exists once the page calls `signing.remind`. Notification permission has to come from a user
  action, so there's no reminder by default.

## What failed

- Nothing much. The first iOS build failed on a `?? NSNull()` type mismatch in a dictionary literal. Fixed.

## Checks run

- `native/test_sideload.py`: 3 tests, all 10 Swift groups pass. I printed the Swift output to make sure they really ran.
- `native/test_sign.py` (I6's suite) still passes after the IPASigner hooks.
- `native/build.sh ipa`: builds with no warnings. The executable links AVFAudio and UserNotifications, and the IPA's
  Info.plist has `UIBackgroundModes: [audio]`.

## Not verified

- **Nothing on an iPhone**: the brief says no device test, and the 4S runs iOS 6, so it can't run the sideload
  build. Not checked:
  - whether silent audio keeps the install server alive through a big IPA;
  - whether `installProgressForBundleID:makeSynchronous:` and `applicationIsInstalled:` answer for a sideloaded app
    on iOS 15 to 27 (docs/sideload.md says Feather uses them; untried here);
  - that the reminder notification fires;
  - that the replacement icon shows on the home screen. The asset catalog may still win on some iOS versions, even
    with `CFBundleIconName` gone;
  - that iOS 26 accepts an arm64e slice after the fix-up (taken from Feather and LiveContainer, not tried);
  - Apple's real OCSP responder: tested only against `cryptography`'s responses, not live `ocsp.apple.com`. The
    request shape is standard, but Apple may want GET or answer differently.
- Re-sign All's install-one-by-one logic and the `signing.*` bridge calls have no automated test (they are UIKit
  and Network code that only runs on iOS). They only compile.
