# B151: IX Code 46 (the App Store's install coordinator) on the This iPhone route

## What happened
Installing X (com.atebits.Tweetie2) through Lite's This iPhone route (installd over LocalDevVPN) failed with
`IXErrorDomain Code=46 "A coordinated app install already exists for com.atebits.Tweetie2 (creator App Store) but
request by mobile_installation_proxy had scope requirement IXCoordinatorScopeRequirementRequired"`. The run page
showed installd's whole dump as the row's line. Deleting the App Store X and restarting the iPhone didn't clear it
(user): installcoordinationd keeps the App Store's coordinator (a download, update or placeholder that never
finished) for that bundle ID.

## What changed
- `web/app/core/apprun.js`: `coordinatorBusy(text)` spots the error (the "coordinated app install already exists"
  sentence, or IXErrorDomain with Code 46). The run's `fail()` then gives the row our own short line, never the dump:
  - an install with an IPA (link or My IPAs), not iFizBox itself: "Failed: the App Store holds this app's install.
    Tap to install it with its own bundle ID" and `row.busy = true`;
  - otherwise (iFizBox itself, a record-only re-sign, the helper, or already off): "... Cancel its download, then Retry".
  The Log's error line (`busyText`) names the bundle ID, says delete/restart doesn't clear it, and gives both ways out
  (own bundle ID, or cancel the App Store's download from the Home Screen icon / App Store, then Retry). The shell's own
  grey lines under the app still carry installd's raw text for diagnosis.
- `run.ownIdRetry(id)`: the row's job gets `options.edits.keepBundleId: false` (signing-client.js `prepareParams`
  already sends edits, and `withKeep` lets the job's own choice win), and the row signs and installs again from the
  start. A different bundle ID has no coordinator. Only that app; the global setting is untouched.
- `web/app/screens/apprun.js`: a failed `busy` row's tap calls `ownIdRetry` instead of the plain retry. Retry All
  stays a plain retry under the same ID (for when the App Store finished or the user cancelled its download).
- Tests: two in `apprun.test.js` with the user's error string.

## (2) Does leaving the app mid-install hang or retry into it?
Read the route: `IDevice.install` (native/sideload/idevice/IDevice.swift) makes one
`installation_proxy_install_with_callback` per tap, no retry; every step has a time limit, and KeepAlive holds the app
alive in the background. `createAppRun` never retries by itself (`away()` only changes how an `installed:false` reads).
So leaving the app can't retry into Code 46; installd checks for a coordinator when the install starts, so the
error comes from the App Store's coordinator, not from our earlier slow attempt (it survived a reboot, and our
installation_proxy request creates no lasting coordinator of its own as far as the error shows: "creator App Store").

## Can anything we reach list or cancel the coordinator?
installation_proxy's commands are Browse, Lookup, Install, Upgrade, Uninstall, Archive/Restore/LookupArchives/
RemoveArchive and CheckCapabilitiesMatch: nothing about coordinators. Install options (PackageType, ApplicationSIF,
iTunesMetadata...) don't change the scope requirement either. Lockdown has no service for it; installcoordinationd's
API (IXAppInstallCoordinator cancel) is private and reachable only from a process with its entitlements, which Lite
doesn't have. One untried idea: installation_proxy `Uninstall` of the bundle ID while the placeholder is on the
phone might cancel the App Store's coordinator, but the user already deleted the app and it stayed, so it was not
built.

## Not verified
- On a phone: no device was reachable (`idevice_id -l`: no device list, nobody plugged in). The friendly line and the
  own-ID retry are checked by unit tests only; a real Code 46 retry under a new ID on the user's iPhone is untested.
- A read-only installation_proxy Lookup of com.atebits.Tweetie2 (to see a leftover placeholder) wasn't run: no phone
  on USB, and over Wi-Fi the phone hangs up after a Lookup (B120 note in memory).
- Whether the App Store's coordinator ever clears by itself (e.g. after signing in/out of the App Store, or
  cancelling a pending download in App Store > Account): needs the user's phone.
