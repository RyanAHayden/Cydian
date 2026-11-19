# F236: is this iPhone in the signing profile?

A development profile without the phone's UDID made every install fail with iOS's "integrity could not be verified".
Now the profile is checked against this phone and the page says so plainly.

## What was done

- **Helper:** `ifizbox-helper udid` (native/helper/main.c `print_udid`): `MGCopyAnswer("UniqueDeviceID")` via dlopen,
  one line, runs nothing, special-cased before policy.c's plans (as F232's remove-malware). Off iOS: exit 74 with a
  reason. entitlements.plist gains `com.apple.private.MobileGestalt.AllowedProtectedKeys: [UniqueDeviceID]`.
  Host tests: native/helper/test_udid.py.
- **Pure check, twice:** native/sign/DeviceCheck.swift and web/app/core/signing.js (`deviceCheck`, `phoneFromDevices`,
  `deviceCheckText`, `notInProfileText`, `likelyCauseText`, `notLandedText`; parseProfile now has `udids`). States
  in / out / unknown / skip. A set of candidates (the sideload app's own embedded profile with several devices): all
  listed = in, none = out, some = unknown. ProvisionsAllDevices or no list = skip. UDIDs compare without case and are
  shown as the phone gave them. A node test keeps the Swift sentences equal to the JS ones.
- **Where the phone's UDID comes from:** native/Sources/PhoneID.swift: jailbreak = the helper (fallback: Paid.udid,
  the app's own MobileGestalt read that already existed for paid packages); sideload = Bundle.main's
  embedded.mobileprovision. Read once. New bridge call `device.udid` in every build.
- **Wiring:** `signing.status` profile gets `device`; `signing.install`'s reply gets `device`; Sideload.signAndOpen
  (install and re-sign) and MyIPAs.signIfNeeded throw `device_not_in_profile` with the sentence before signing.
  core/signing.js deviceError maps it to "iPhone Not in Profile", opening Settings > Signing.
- **Settings > Signing** (screens/settings.js `profileGroup`, rows from screens/signing.js `deviceRows`): under the
  Provisioning Profile, "This iPhone: In Profile / Not in Profile / Unknown", the sentence as the group footer (red
  when not in), UDID and Copy UDID when out with a known UDID. The website's page shows the unknown text for a profile
  with a device list (it can't read a UDID).
- **Installs that don't land:** followInstall (signing-sheet.js) adds a warning line with the likely cause when the
  check was "unknown" (from the install reply, or the last signing.status for My IPAs). The website's watchInstall
  takes `cause` (signing-client.js `siteCause`) and adds it once iOS has the app, and on its timeout.
- docs/signing.md: "Is this iPhone in the profile?".

## On the iPhone 7

- A probe built from main.c's `print_udid` (scratchpad, `#define main helper_main` + `#include "main.c"`, since the
  real helper refuses ssh callers), signed with the helper's entitlements: answered
  `cb21a7f0caffd4807d41e713456f134cc958b076` as mobile and as root.
- The same probe signed **without** the MobileGestalt entitlement (just platform-application + no-container) also
  answered as root on iOS 15.8.8 / palera1n. Kept the entitlement anyway (Sileo and Paid.swift use it; other iOS
  versions may refuse without it).
- That UDID run through core/signing.js: a profile listing it plus another device -> "This iPhone is in the profile.";
  the test fixture (3 other devices) -> "This iPhone isn't in the profile: add its UDID … to the developer account,
  then make the profile again."
- Installed the new .deb (0.9.8-1579): the shipped helper carries the entitlement and the udid code, still refuses an
  ssh caller (77); the app opens on Settings (screenshot ref/7/screens/f236-settings.png).

## Tried and dropped

- Nothing failed outright. Profiles on the 7: /var/MobileDevice/ProvisioningProfiles has only mis.db and no installed
  app has an embedded.mobileprovision, so the "profile that has it" is a constructed one.

## Not verified

- **The real helper spawned by the app answering `udid` on the 7**: it refuses every caller but the app, and nothing
  in the jailbreak build's UI calls `device.udid` (signing.* is refused there; the task asked for no screen there).
  Verified with a probe compiled from the same function instead.
- **The sideload build on a phone** (embedded.mobileprovision read, Settings > Signing's rows, the
  device_not_in_profile error before signing, the warning line after Done): no sideload-signed iFizBox on a test
  phone, and no developer profile with the 7's UDID. Covered by node and Linux Swift tests only.
- **The website's likely-cause line on a real iPhone**: needs a user certificate whose profile lacks the phone; node
  tests only. The "Ready to Install" alert path (when the early link can't be used) doesn't watch iOS, so it adds no
  line there.
- **The Settings rows' look** (red footer, Copy UDID, clipboard) wasn't rendered in a browser; they reuse the existing
  grouped cells and the `sign-warning` footer class.
- Left on the 7: /tmp/udidprobe, /tmp/entitlements.plist and /tmp/iFizBox-f236.deb (files outside the worktree are
  not deleted by this session's rules; harmless in /tmp).
