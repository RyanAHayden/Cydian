# native/: the app (jailbreak .deb and sideload IPA)

A Swift shell around one WKWebView that shows `web/app/` from the app bundle (docs/native.md, "R3 answers").

- `Sources/App.swift`: app, scene and the web view. Navigation is web/app/'s own JS stack and edge swipe (R3 (a)).
  The shell switches off WebKit's `PreferPageRenderingUpdatesNear60FPSEnabled` and WebKit's history swipe.
- `Sources/Bridge.swift`: the `ifizbox` message handler (`ping`, `app.info`, `app.theme`: the Appearance setting drives the window's interface style, F23), the `ifizbox://app/` scheme
  serving `iFizBox.app/web/`, and the private WebKit feature switch.
- `Sources/Apt.swift` (N3): the calls behind `web/app/backend-native.js`: `apt.sources`, `apt.list`, `apt.dpkgStatus`
  (apt's and dpkg's files under the jailbreak prefix), `net.fetch`/`net.packages` (repos fetched by the shell; .xz and
  .gz decompressed), `helper.run` (ifizbox-helper through `helper/spawn.c`, output streamed), `haptic.tap`. Errors
  are `"<code>: <message>"`. `Sources/iFizBox-Bridging-Header.h` brings in `spawn.h`.
- `Sources/Paid.swift` (F57): paid packages' shell calls for `web/app/screens/extras.js`: `net.request` (vendors'
  POSTs, no CORS), `device.info` (MobileGestalt UDID, hw.machine), `keychain.get/set/remove` (payment secrets behind
  the passcode / Face ID), `auth.session` (ASWebAuthenticationSession, callback scheme `sileo`), `paid.install`
  (download the one-time .deb into `HELPER_PAID_DIR`, `ifizbox-helper install-paid`). The fake vendor for tests is
  `fake/fake-vendor.mjs` (`web/app/backend-native-paid.test.js`).
- `bridge.js`: injected at document start (a WKUserScript), it sets up `ifizboxNative` (`call`, `emit`, `helper`,
  `dpkgStatus`) and `ifizboxApp` before any module of `web/app/` runs.
- `fake/`: the Swift side in node for tests without a device: `fake-native.mjs` (same methods over a fixture
  prefix), `ifizbox-helper` (a shell stand-in with the real allowlist; `update` copies `fixture/remote/lists/` into
  apt's lists) and `fixture/`. `web/app/backend-native.test.js` uses it; N4's queue tests can too.
- `Info.plist` (with `CADisableMinimumFrameDurationOnPhone`), `entitlements.plist`, `VERSION`, `icon/` (`icon.svg`
  and the PNGs made from it with `rsvg-convert -w 120|180`), `deb/` (control, postinst, prerm).
- `daemon/` (N5): `ifizbox-upgrades`, a launchd daemon in the .deb. Once a day it runs `apt-get update`, sets the icon
  badge to the upgrade count and posts "n Upgrades" when something is new (daemon/README.md).
- `build.sh` / `make package` → `build/iFizBox.deb`: rootless (`/var/jb/Applications/iFizBox.app`, and the helper at
  `/var/jb/usr/libexec/ifizbox/ifizbox-helper`, 0755, no setuid),
  `iphoneos-arm64`, arm64, iOS 15+. Version is `VERSION-<commit count>`; CFBundleVersion is the commit count.
- `mkdeb.py`: writes the .deb with the stdlib (no dpkg-deb needed) and checks one (`make check`).
- `Sources/mode.c`, `Sources/Mode.swift`: the mode, picked at launch (I2): `jailbreak` when the N2 helper is an
  executable file at `Jailbreak.helper` (`/var/jb/usr/libexec/ifizbox/ifizbox-helper` rootless, under roothide's
  jbroot, or at / rootful), else `sideload`. Swift calls `ifizbox_mode_at` through the bridging header. The page gets
  it as `ifizboxNative.mode` (bridge.js's `@MODE@`, read by core/settings.js `detectMode`) and in `app.info`.
  Every mode shows every tab (Installed holds the remembered apps in the sideload build).
- `mkipa.py`, `Info-sideload.plist`, `entitlements-sideload.plist`: the sideload IPA (I2). Same executable, signed
  ad hoc with `get-task-allow` only, Info.plist plus the overlay (docs/sideload.md, "What I2 needs"), zipped as
  `Payload/iFizBox.app` with no helper. Ship it unsigned/ad hoc: the user signs it with Feather, AltStore,
  SideStore or TrollStore. `mkipa.py check` refuses a helper, jailbreak entitlements or a missing overlay.
- `sign/` (I6): the on-device signer, plain Swift that also builds on Linux: `Zip.swift` (streaming zip read/write
  over zlib), `Hash.swift`, `DER.swift`, `CodeSign.swift` (Mach-O signatures, CMS, DER entitlements),
  `Profile.swift` (I5's profile rules), `IPASigner.swift` (bundles inside out, CodeResources), `Manifest.swift` (the
  itms-services manifest and link), `Handoff.swift` (F75: the certificate inside iFizBox's own IPA, the `ifizbox://`
  links the shell takes, gunzip), `HTTP.swift`, `certs/` (Apple's
  public WWDR and root certificates, copied into the app). `tests/main.swift` + `test_sign.py` test it on Linux.
- `intents/` (N8): App Intents for Shortcuts, Siri, Spotlight and the Action button (Check for Updates, Add Source,
  Restore My Packages in both modes; Install All Updates, Respring, Userspace Reboot, Export My Packages in jailbreak
  mode), and `intents/metadata.py`, which writes `iFizBox.app/Metadata.appintents` from the compiler's constant values
  in place of Xcode (intents/README.md; docs/shortcuts.md).
- `widget/` (N8): `PlugIns/iFizBoxWidget.appex` (iOS 17+), the update-count widget, and in the .deb's build Respring and
  Userspace Reboot as Control Center controls (widget/README.md).
- `share/` (N9): the share sheet and Open in iFizBox: `PlugIns/iFizBoxShare.appex` for links, document types (.ipa, .deb)
  for files, and what each build does with a repo, an AltStore source, an IPA or a .deb (share/README.md).
- `Sources/SignStore.swift`, `Sources/InstallServer.swift`, `Sources/SignBridge.swift` (I6): the Keychain identity,
  the loopback HTTP server for the signed IPA, and the `signing.*` bridge calls (sideload build only). See
  docs/signing.md, "On the phone (I6)".

## Build

    SWIFT_TOOLCHAIN=/path/to/swift-6.4.2-RELEASE-ubuntu24.04 IOS_SDK=/path/to/iPhoneOS.sdk make -C native package

`make package` builds both `build/iFizBox.deb` and `build/iFizBox.ipa`; `make deb` / `make ipa` build one.

`build.sh` explains what each variable is and finds rustup's `ld64.lld` and `rcodesign`/`ldid` by itself.
`tools/check.sh` runs the build when `native/build.sh --probe` finds all of it, and skips it with a note otherwise.
