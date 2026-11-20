# T58: iPhone 15 Pro as the sideload test phone, driven from Linux

Done live with the user present (control session), 2026-11-20.

## Choice

baguette (the user's suggestion) needs macOS 15 + Xcode 26 and only touches, no buttons or lock. The user's other Mac
is on Sonoma. Picked go-ios + WebDriverAgent instead: all from Linux, WDA also does Home, lock, unlock, typing and the
accessibility tree. The Mac (MBA, macOS 15.8.3, Xcode 26.3) is only needed to rebuild WDA.

## What was done

1. The signing folder held only ad hoc / distribution profiles; XCUITest needs `get-task-allow`. With the App Store
   Connect API key (team S8NFX3A2LT): new Apple Development certificate (id Q25FS9LG35, new RSA key) and an
   `IOS_APP_DEVELOPMENT` profile on the existing `com.ryha.*` bundle ID with the phone (device K4KYB5N8CY), profile
   YJ6U93KKPF, expires 2027-11-20. Kept beside the other signing files (outside the repo), `.p12` password in a file
   next to it. An older "Created via API" dev cert (JZ7HRY6S9F) exists whose key wasn't found; left alone.
2. go-ios v1.3.2 (`ios-amd64` from the GitHub release) on PATH. `ios tunnel start --userspace` works without root.
3. WDA: `xcodebuild build-for-testing ... CODE_SIGNING_ALLOWED=NO PRODUCT_BUNDLE_IDENTIFIER=com.ryha.wda` on the MBA,
   then codesign over ssh with a throwaway keychain.
4. `ios install` WDA.ipa, `ios image mount` Xcode's iOS_DDI, `ios runwda`, `ios forward 8100 8100`: `/status` ready,
   sdk 26.2 on iOS 27.0.1.
5. `tools/ui-15.sh`: lock, up, tap, swipe, type, open, launch, install, home, lock-button, wake, shot, source.

## Failed on the way

- `ios image auto` downloads a third-party DDI (deviceboxhq.com, build 17E5179g) and then fails TLS to gs.apple.com
  (`x509: certificate signed by unknown authority`): Apple Root CA isn't in Arch's bundle for server auth. Fixed
  with `SSL_CERT_FILE` = system bundle + Apple Root CA, and Xcode 26.3's own DDI from the MBA (build 17C529).
- `ios image mount --path` wants the `Restore/` folder (BuildManifest.plist), not `iOS_DDI/`.
- macOS `security import` refused the OpenSSL 3 `.p12` ("MAC verification failed"): re-pack with `-legacy`.
- `codesign --keychain K` alone said "no identity found": the keychain must be on the user search list.
- go-ios's runwda never printed "ServerURLHere" here; WDA was up anyway (check `/status`, not the log).
- No "trust developer" step on the phone: a development profile listing the device needs none.

## Checked

- Warm: launch iFizBox, tap Sources (screenshot showed Sources), swipe, home (App Library page), source (XML tree).
- Cold: stopped tunnel, WDA and forward; `ui-15.sh T58 up` brought all back in 4 s, then launch + tap Changes
  showed the Changes page (`ref/15/screens/t58-changes.png`).

## Not verified

- `ui-15.sh install` of a freshly built Lite IPA (`make -C native ipa`): the phone already runs Lite 0.17.1, and the
  IPA needs signing for this phone first (the in-repo signers; not wired into ui-15.sh). `install` itself was used
  for WDA.ipa through go-ios directly.
- `open ifizbox://sources` and `wake` checked. `type` and `lock-button` not run (no text field focused; didn't want to lock the user's phone while
  they were using it).
- Behaviour after a phone reboot (DDI remount through `up`).

## Follow-up (T60)

- `install` signs with a native zsign (the pinned commit, built from source) and the explicit ad hoc profile +
  distribution cert, keeping the bundle ID; the released Lite 0.17.1 IPA signed and installed in about 3 s. A
  non-IPA with `--as-is` fails with "install failed". (go-ios logs success on stderr, so the exit code is checked.)
- `type` checked: "tennis" in Search showed OpenTennis.
- `lock-button` with `/wda/lock` opened Siri setup (a held press on iOS 27). Replaced by
  `/wda/performIoHidEvent` page 12 usage 48 (consumer power) for 0.05 s: `/wda/locked` true; `wake` -> false,
  back in the app.
- Reboot (`ios reboot`): back on USB in about 40 s; `up` remounted the DDI ("reusing existing device-side
  manifest, skipping Apple TSS") and restarted WDA in 5 s.
- Opening WebDriverAgent from the Home Screen closes it at once (user saw it): expected, it only runs under XCTest.
