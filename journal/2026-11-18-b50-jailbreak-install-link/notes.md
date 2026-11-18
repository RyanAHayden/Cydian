# B50: ifizbox://install in the jailbreak app installs through the helper

## Cause
`incoming.js` `confirmInstall` (used by `ifizbox://install?url=…` and F83's other sideloaders' install links) always
ran `signing-client.js` `signAndInstall`. In the jailbreak build there is no signer: `signAndInstall` is a guard that
only shows "Can't Install Here" and returns false, so `ipa.install` was never called and the IPA was never requested.
That matches the report (the served IPA was never fetched, no crash). Why the phone showed the Home Screen instead of
that alert was not reproduced (see Not verified); either way nothing downloaded.

## Fix
- `web/app/incoming.js`: new exported `defaultInstall()` picks what Install runs. In the jailbreak build
  (`ipaInstallAvailable()`) it's `screens/ipa-install.js` `openIpaInstall` (download + `ifizbox-helper install-ipa` via
  `ipa.install`, the progress page with Cancel, the Console Logs entry), the same path Settings > Install IPA and a
  tapped .ipa link use, and the installed app is remembered by bundle id (`rememberIpa`, name from the link or the
  file). Elsewhere it's still `signAndInstall`. Covers both `ifizbox://install` and F83 `other-install` links.
- No change was needed in `myipas.js`, `signing-client.js` or `Apt.swift`: `ipa.install` already downloads and
  installs (backend-native-ipa.test.js covers it against the fake helper).
- `web/app/incoming-jailbreak.test.js`: jailbreak Install runs the helper path with the name and remembers the app;
  sideload and site still get `signAndInstall`; the link's Install goes all the way to an `ipa.install` call carrying
  the IPA's URL (through `runIpaInstall` with a fake bridge).

## Not verified
- On the iPhone 7: not run. It needs a new .deb built and installed on the phone, and the task didn't ask for a
  device run. So the "goes to the Home Screen" symptom was not reproduced, and the fix isn't confirmed on the device.
  To check: install the build, then `tools/ui-7.sh <ID> open 'ifizbox://install?url=<served ipa>'`, tap Install,
  and watch for the progress page and a request in the server's log.
- `openIpaInstall`'s page (DOM) isn't exercised in node; the tests swap in a stand-in for it.
