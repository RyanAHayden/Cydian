# F283 Developer Mode: the real status when paired

## Scope decided
The brief's first half (show Developer Mode only for Development profiles) was overruled by the user's own test,
noted on the task: "keep Developer Mode for every kind; show the real status when paired" (iOS 27 Ad Hoc needs it
too; memory ios27-adhoc-needs-developer-mode). So no profile-kind gating: the free Apple ID page, the pairing guide,
the "refused" alert and the guides keep their Developer Mode text as is. Only the real status read was built.

## What changed
- `native/sideload/idevice/IDevice.swift`: `Session.developerMode()` asks lockdown (GetValue, domain
  `com.apple.security.mac.amfi`, key `DeveloperModeStatus`) over the existing pairing, both kinds (RemotePairing
  via `lockdownd_connect_rsd`, lockdown via `lockdownd_connect`), like `udid()`; returns nil when the value isn't a
  boolean (iOS < 16 has no Developer Mode). `IDevice.readDeveloperMode()` runs it under `watched("devmode")`, so it
  has the usual time limits.
- `IDeviceBridge.swift`: `idevice.developerMode` -> `{on: true|false|null}`, on IDevice.queue (`run`), refused in
  the jailbreak build like the other idevice calls.
- `web/app/core/installroute.js`: `developerModeInfo(on)` (on: row; off: row + steps, red; else nothing),
  `DEV_MODE_STEPS`, `canReadDeveloperMode(status)` (paired and `vpnOn`).
- `web/app/screens/installroute.js`: Settings > Installation & Signing, This iPhone group: after idevice.status, when
  paired with the VPN/Tailscale on, it asks idevice.developerMode and repaints with a Developer Mode row under
  Pairing; off puts the steps before the VPN note in the footer, in red (`sign-warning`). Any failure (older shell
  without the call, timeout) shows no row.
- Placement: the brief said "next to the profile". I put the row in the This iPhone group (same page, just above
  the Provisioning Profile group) instead of adding a part to settings.js's layout: the status comes from the
  pairing, which that group already reads, and settings.js is a busy file other slots touch. Easy to move later.
- Tests: `web/app/screens/installroute-devmode.test.js` (rule, when it's asked, the group, the page with a fake
  bridge: off/on/VPN off/Signing Server/error). docs/sideload.md: one paragraph.

## Not verified
- The Swift doesn't compile here (Linux, no swiftc/Xcode); `plist_get_node_type(v) == PLIST_BOOLEAN` and
  `plist_get_bool_val` are in the vendored idevice.h (libplist API), but the build is unchecked. The next sideload
  build (MBA/CI) is the check.
- Not run on a phone: no iOS 16+ phone paired through This iPhone was available to this unattended run (the iPhone 7
  is the jailbreak build, iOS 15, no Developer Mode). That lockdown answers DeveloperModeStatus to a RemotePairing
  client on iOS 27 is from libimobiledevice/idevice usage, not measured here.
