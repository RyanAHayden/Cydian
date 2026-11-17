# native/: the app (jailbreak .deb and sideload IPA)

A Swift shell around one WKWebView that shows `web/app/` from the app bundle (docs/native.md, "R3 answers").

- `Sources/App.swift`: app, scene and the web view. Navigation is web/app/'s own JS stack and edge swipe (R3 (a)).
  The shell switches off WebKit's `PreferPageRenderingUpdatesNear60FPSEnabled` and WebKit's history swipe.
- `Sources/Bridge.swift`: the `cydian` message handler (`ping`, `app.info` so far), the `cydian://app/` scheme
  serving `Cydian.app/web/`, and the private WebKit feature switch.
- `Info.plist` (with `CADisableMinimumFrameDurationOnPhone`), `entitlements.plist`, `VERSION`, `icon/` (`icon.svg`
  and the PNGs made from it with `rsvg-convert -w 120|180`), `deb/` (control, postinst, prerm).
- `build.sh` / `make package` → `build/Cydian.deb`: rootless (`/var/jb/Applications/Cydian.app`),
  `iphoneos-arm64`, arm64, iOS 15+. Version is `VERSION-<commit count>`; CFBundleVersion is the commit count.
- `mkdeb.py`: writes the .deb with the stdlib (no dpkg-deb needed) and checks one (`make check`).
- `Sources/mode.c`, `Sources/Mode.swift`: the mode, picked at launch (I2): `jailbreak` when the N2 helper is an
  executable file at `/var/jb/usr/libexec/cydian/cydian-helper`, else `sideload`. Swift calls the C through
  `@_silgen_name` (no bridging header). The page gets it as `globalThis.cydianApp.mode` (a document-start user
  script) and in `app.info`; `web/app/mode.js` drops the apt-only tabs (Installed) in sideload mode.
- `mkipa.py`, `Info-sideload.plist`, `entitlements-sideload.plist`: the sideload IPA (I2). Same executable, signed
  ad hoc with `get-task-allow` only, Info.plist plus the overlay (docs/sideload.md, "What I2 needs"), zipped as
  `Payload/Cydian.app` with no helper. Ship it unsigned/ad hoc: the user signs it with Feather, AltStore,
  SideStore or TrollStore. `mkipa.py check` refuses a helper, jailbreak entitlements or a missing overlay.

## Build

    SWIFT_TOOLCHAIN=/path/to/swift-6.4.2-RELEASE-ubuntu24.04 IOS_SDK=/path/to/iPhoneOS.sdk make -C native package

`make package` builds both `build/Cydian.deb` and `build/Cydian.ipa`; `make deb` / `make ipa` build one.

`build.sh` explains what each variable is and finds rustup's `ld64.lld` and `rcodesign`/`ldid` by itself.
`tools/check.sh` runs the build when `native/build.sh --probe` finds all of it, and skips it with a note otherwise.
