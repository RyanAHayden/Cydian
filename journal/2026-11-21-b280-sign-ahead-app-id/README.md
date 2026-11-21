# B280: sign-ahead keeps the installed App ID

R56 run 3 on the 15 Pro: the queue's Re-sign of Probe (installed under S8NFX3A2LT.com.ryha.sideload with the
com.ryha.* profile) signed it as TEAM.<bundle ID>, and iOS refused the update with appid_mismatch. Sign-ahead
(`SignAhead.sign`) built its own `IPASigner` without B138's `installedAppID` hook that `Sideload.signAndOpen` sets,
and its `SignedRecord` left out `appID`.

## What I did

- `native/Sources/SignAhead.swift`: `signer.installedAppID = { Sideload.installedAppID($0, log: log) }` before
  `signer.sign`, and `appID: app.appID` in the record, as signAndOpen does. `installedAppID` reads the records file
  (atomic writes) and waits on `IDevice.queue` with a 25 s limit; it runs on sign-ahead's own `signer` queue, never
  on `IDevice.queue`, so it can't deadlock.
- `native/test_sign_ahead_appid.py`: reads the source (the shell can't run off the phone, as
  `test_sign_ahead_self.py`): the hook is set before the signing, the record carries `appID`.

The brief said "test in native/sign/tests"; those Swift tests build only `native/sign/`, and `SignAhead.swift`
lives in `native/Sources/` with the UIKit shell, so it can't be built there. The signer side the hook drives
(installedAppID → the App ID it signs with → `SignedApp.appID`) is already covered there by B138's tests
(`native/sign/tests/main.swift`, around line 320). So the new test is a source check instead.

## Not verified

- On the iPhone 15 Pro: a queue Re-sign of an app installed under another App ID now updates it. Not run: this
  session was unattended and the 15's sideload build would need this branch built and installed first; the fix is
  the same two lines signAndOpen has used since B138, which R56 saw working on the 15 for the non-queue path.
