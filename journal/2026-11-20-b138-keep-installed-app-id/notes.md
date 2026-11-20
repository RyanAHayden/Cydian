# B138: an update keeps the App ID it was installed with

The user's iPhone 18 Pro: a queue install of YouMod on the This iPhone route failed with installd's
`MismatchedApplicationIdentifierEntitlement` (idevice's UnknownErrorType, code 15). The installed copy had
`application-identifier S8NFX3A2LT.com.ryha.*` (signed under the `com.ryha.*` wildcard profile, the wildcard written
as it is), the update `S8NFX3A2LT.com.ryha.sideload` (the explicit profile the user has now). installd compares the two
strings and refuses any difference; only deleting the app (and its data) gets past it.

## What changed

- `native/sign/AppIDMatch.swift` (new): `entitlementsID(profile, installed:)` says which App ID a profile signs with
  to give an installed application-identifier: an explicit profile only its own; a wildcard its own pattern as written
  (`TEAM.com.ryha.*`, how the installed YouMod has it) or any ID under its prefix; never another team. `pick` takes the
  first of the candidate profiles that can. `mismatch` words the stop (both App IDs, import the profile it was
  installed with, or delete and reinstall: its data is lost). `isMismatch`/`installdText` for installd's raw refusal.
- `IPASigner`: `installedAppID` hook, asked with the bundle ID the app installs as right after the IDs are worked out
  and before anything is signed. A difference: the candidates are the profile it would use (an own ASC profile when
  one was made) and the imported one; the first that fits signs (its embedded profile and its App ID in the
  entitlements); none: `SignError("appid_mismatch", …)` and nothing is written. `SignedApp.appID` carries the
  application-identifier it was signed with.
- `SignedRecord.appID` (optional; older records decode with nil): kept with each record from now on.
- `Sideload.installedAppID(bid)`: our record's appID; else, when the app is installed (record or
  `Workspace.isInstalled`) and a pairing exists, installd's own answer through the pairing
  (`IDevice.installedAppID`: installation_proxy Browse, ReturnAttributes CFBundleIdentifier + Entitlements). That runs
  on IDevice.queue with a 25 s cap (the queue can be held by a pairing that waits): no answer means "can't tell" and
  signing goes on as before.
- installHere: installd's error 15 for this refusal becomes `appid_mismatch: <plain words>` (both routes' single
  install page and the queue).
- `web/app/core/apprun.js`: the row's error goes through `installdText`: the App ID refusal in plain words, any other
  UnknownErrorType as "iOS refused to install it: <installd's ErrorDescription>". Never the raw text.

## Decisions

- The task's check asked for a *node* test of the profile choice. The choice is made on the phone, where the profiles
  are (the imported one in SignStore, the own ASC ones made per app inside IPASigner); a JS copy would be dead code
  that could drift. So the choice is tested in Swift (`native/sign/tests/main.swift`, "B138: the profile is picked
  from the installed App ID (wildcard vs explicit)", run by `native/test_sign.py` in the gate), and node tests the
  words (`web/app/core/apprun-b138.test.js`, a fake bridge whose signing.open answers idevice's error 15 text, and
  one whose signing.prepare answers appid_mismatch).
- "Offer delete and reinstall": a stock iOS app can't delete another app on its own, so the words say how (delete it
  from the Home Screen, install again, data lost). An in-app Delete through installation_proxy Uninstall would need a
  confirm sheet and the pairing: not done here.
- Only the exact name `MismatchedApplicationIdentifierEntitlement` counts as this refusal: code 15 is idevice's code
  for *every* installd error it has no type for, so "(15)" alone says nothing.

## Not verified

- On a phone: nothing. The 18 Pro is the user's daily phone (read only), and the iPhone 7 test phone runs the
  jailbreak build, which refuses `signing.*`. So `IDevice.installedAppID` (that installd's Browse honours `BundleIDs`
  and returns `Entitlements` with `application-identifier` through idevice's FFI) and the whole stop-before-signing
  path on YouMod are untested on hardware; the native code compiles (gate's native build) and the signer's part is
  covered by the Linux Swift tests.
- The exact text idevice gives on the phone: the screenshot said "UnknownErrorType"; idevice's Display form is
  "unknown error `…` returned from device"; both are handled (case-insensitive), but only the second was seen in
  idevice's source.
- The website signer (core/websign.js, browser zsign) has the same exposure and wasn't touched (not this task's files).
