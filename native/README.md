# native/: the jailbreak app

A Swift shell around one WKWebView that shows `web/app/` from the app bundle (docs/native.md, "R3 answers").

- `Sources/App.swift`: app, scene and the web view. Navigation is web/app/'s own JS stack and edge swipe (R3 (a)).
  The shell switches off WebKit's `PreferPageRenderingUpdatesNear60FPSEnabled` and WebKit's history swipe.
- `Sources/Bridge.swift`: the `cydian` message handler (`ping`, `app.info`, `app.theme`: the Appearance setting drives the window's interface style, F23), the `cydian://app/` scheme
  serving `Cydian.app/web/`, and the private WebKit feature switch.
- `Sources/Apt.swift` (N3): the calls behind `web/app/backend-native.js`: `apt.sources`, `apt.list`, `apt.dpkgStatus`
  (apt's and dpkg's files under the jailbreak prefix), `net.fetch`/`net.packages` (repos fetched by the shell; .xz and
  .gz decompressed), `helper.run` (cydian-helper through `helper/spawn.c`, output streamed), `haptic.tap`. Errors
  are `"<code>: <message>"`. `Sources/Cydian-Bridging-Header.h` brings in `spawn.h`.
- `bridge.js`: injected at document start (a WKUserScript), it sets up `cydianNative` (`call`, `emit`, `helper`,
  `dpkgStatus`) and `cydianApp` before any module of `web/app/` runs.
- `fake/`: the Swift side in node for tests without a device: `fake-native.mjs` (same methods over a fixture
  prefix), `cydian-helper` (a shell stand-in with the real allowlist; `update` copies `fixture/remote/lists/` into
  apt's lists) and `fixture/`. `web/app/backend-native.test.js` uses it; N4's queue tests can too.
- `Info.plist` (with `CADisableMinimumFrameDurationOnPhone`), `entitlements.plist`, `VERSION`, `icon/` (`icon.svg`
  and the PNGs made from it with `rsvg-convert -w 120|180`), `deb/` (control, postinst, prerm).
- `build.sh` / `make package` → `build/Cydian.deb`: rootless (`/var/jb/Applications/Cydian.app`, and the helper at
  `/var/jb/usr/libexec/cydian/cydian-helper`, 0755, no setuid),
  `iphoneos-arm64`, arm64, iOS 15+. Version is `VERSION-<commit count>`; CFBundleVersion is the commit count.
- `mkdeb.py`: writes the .deb with the stdlib (no dpkg-deb needed) and checks one (`make check`).

## Build

    SWIFT_TOOLCHAIN=/path/to/swift-6.4.2-RELEASE-ubuntu24.04 IOS_SDK=/path/to/iPhoneOS.sdk make -C native package

`build.sh` explains what each variable is and finds rustup's `ld64.lld` and `rcodesign`/`ldid` by itself.
`tools/check.sh` runs the build when `native/build.sh --probe` finds all of it, and skips it with a note otherwise.
