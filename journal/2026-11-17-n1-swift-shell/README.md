# N1: Swift shell and Cydian.deb

## What I did
- **`native/`**: the jailbreak app (see `native/README.md`).
  - One window with one WKWebView. It loads `cydian://app/index.html`, served from `Cydian.app/web/` (a copy of
    `web/app/` without the `*.test.js` files). Navigation is R3's (a): web/app/'s JS stack and edge swipe. The shell
    turns off WebKit's back/forward gesture. It also switches off `PreferPageRenderingUpdatesNear60FPSEnabled`
    through the private `_WKFeature` API; if the selector or key is missing, WebKit's default stays.
  - I did **not** set `html.native`. web/app's CSS hides its own nav bar and tab bar under that class, which only
    makes sense for approach (b).
  - `Info.plist`: scene manifest, `CADisableMinimumFrameDurationOnPhone`, iOS 15.0, portrait, light status bar, and
    icon `AppIcon60x60` @2x/@3x. Version: `native/VERSION` (0.1.0) plus the commit count, which gives
    CFBundleVersion and the deb's `0.1.0-<n>`.
  - Bridge: R3's `WKScriptMessageHandlerWithReply` with `ping` and `app.info`. N3 builds the rest on it.
  - Icon: my own SVG (an open parcel with an arrow, on iOS 6 nav-bar blue). The PNGs are committed, so the build
    doesn't need rsvg-convert.
  - Entitlements: `platform-application`, `no-container`, `no-sandbox` and `application-identifier`. N2 adds
    `com.apple.private.persona-mgmt` when it adds the helper.
- **Build**: `native/build.sh` (`make -C native package`) follows R3's spike recipe: swift.org 6.4.2, `$IOS_SDK`
  and rustup's `ld64.lld`, arm64 only.
  - Linking uses `-adhoc_codesign`, then rcodesign (or ldid) re-signs with the entitlements. rcodesign 0.29
    writes both the XML and the DER entitlements slots.
  - `mkdeb.py` writes the .deb with the stdlib: an ar of debian-binary, control.tar.xz and data.tar.xz. Files are
    root-owned and sorted, with mtime = the commit time, so the output is reproducible.
  - `mkdeb.py check` then checks:
    - the control fields and `Architecture: iphoneos-arm64`;
    - every path under `/var/jb`;
    - a postinst running `uicache -p`;
    - the Info.plist keys, and that its version matches the control file's;
    - the icons;
    - a Mach-O that is arm64, MH_EXECUTE, iOS minos 15.0 and signed;
    - web/index.html, app.js and the rest present, with no tests shipped.
- Result here: `io.github.fizl0.cydian 0.1.0-54 (iphoneos-arm64): 21 web files, arm64 iOS 15.0, 116 KB
  executable`, a 60 KB .deb. It links UIKit, WebKit and Foundation, plus `/usr/lib/swift`; the Swift overlays that
  aren't always present are weak.
- **Gate**: `tools/check.sh` runs `make -C native package` when `native/build.sh --probe` finds the toolchain.
  Otherwise it prints what's missing and goes on. `native/test_native.py` (always runs) tests mkdeb with a fake
  Mach-O: a good package passes, and rootful paths, shipped tests, the wrong arch/minos/no signature and a version
  mismatch are all caught. It also checks the plists.
- **Change relayed by another session from the user** (it matches main's 9dfab83 and 5f91853):
  - Cydian depends on none of the user's other projects. The SDK is found only through `$IOS_SDK`, and the build
    fails with a clear message without it.
  - I removed the opentennis/sidedrop references and the `~/.local/share/hst-ios` default from
    `native/spike/build.sh` and `README.md`. The new build has none either.
- Toolchain: R3's swift.org 6.4.2 had been in a scratchpad that's gone. I downloaded it again, to
  `~/.local/share/swift/swift-6.4.2-RELEASE-ubuntu24.04` (outside the repo, not referenced by it).

## Tried and failed
- The first `mkdeb check` flagged `.`, the tar root, as "not under /var/jb": tarfile stores `./` as `.`. Fixed.
- The toolchain's SwiftShims headers print nullability warnings under the SDK's clang settings, about 40 lines of
  noise in the gate. They are silenced with `-Xcc -Wno-nullability-completeness -Xcc
  -Wno-nullability-inferred-on-nested-type`. On a clean build about 7 orphan `note: in file included from` lines
  (left over from the silenced warnings) still print. They're harmless, so I left them.

## Not verified
- **Nothing ran on a device**, per the user (no newer jailbroken phone). Not checked:
  - that the app launches;
  - that SpringBoard shows the icon;
  - that `uicache -p` / `-u` registers and removes the app on Dopamine or palera1n;
  - that the private 60 fps feature key exists and works on iOS 15–27;
  - the frame rate.
- **The .deb was never installed with dpkg.** dpkg isn't on this machine. Its layout was checked with `ar`/`tar`
  and `mkdeb.py check`; Procursus dpkg reads xz members.
- **arm64e is not built.** The task says arm64 + arm64e, but R3's note on N1 dropped arm64e: lld can't link it, and
  apps don't need it.
- **The gate only builds the .deb where the toolchain is set.** The runner's gate passes `SWIFT_TOOLCHAIN` and
  `IOS_SDK` only if its environment has them. Without them the build is skipped with a printed note; the mkdeb
  tests still run. I ran the gate both ways: with the variables it built and checked the .deb (exit 0); without them it printed
  `check: native build skipped: ... missing swiftc ... missing IOS_SDK` (exit 0). For the gate to build it on this
  machine, the runner's environment needs `SWIFT_TOOLCHAIN=~/.local/share/swift/swift-6.4.2-RELEASE-ubuntu24.04`
  and `IOS_SDK` set to the extracted SDK. That is a machine setting, so it is not in the repo.
- The page still uses `backend-http.js`, so anything that fetches from the server fails offline in the app. The
  native backend is N3.
