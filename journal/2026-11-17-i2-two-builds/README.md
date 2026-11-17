# I2: one app, two builds (jailbreak .deb, sideload IPA)

## What I did

- **Mode at launch.** `native/Sources/mode.c`: `cydian_mode_at(path)` is jailbreak when `path` is an executable
  regular file, else sideload; `cydian_mode()` checks N2's rootless path `/var/jb/usr/libexec/cydian/cydian-helper`.
  C rather than Swift so the very file the app links is compiled and tested on Linux (`native/test_mode.py`: no
  helper → sideload, fake executable helper → jailbreak, non-executable or directory → sideload). Swift reaches it
  with `@_silgen_name("cydian_mode")` (`Sources/Mode.swift`, `AppMode.current`), so build.sh needs no bridging header.
  A sideloaded app is sandboxed, so `stat` on `/var/jb` fails even on a jailbroken phone: sideload, which is right
  since it couldn't spawn the helper anyway.
- **Bridge → web UI.** `App.swift` adds a document-start `WKUserScript` setting `globalThis.cydianApp = {mode}`, and
  `app.info` returns `mode` too. A synchronous global (not an async bridge call) because `router.js` decides its
  `TABS` at import: `web/app/mode.js` (`getMode`, `tabsFor`, `APT_ONLY_TABS`), and `router.js` now has
  `ALL_TABS` and `TABS = tabsFor(ALL_TABS)`. Everything in app.js already loops over `TABS`, so in sideload mode
  the tab, its stack, its `init` and its deep links (`#/installed` → home) all go, with no change to app.js.
  On the site `cydianApp` is unset → mode `web` → all tabs.
- **Which screens are apt-only:** only Installed (dpkg status). Changes stays: it works on the site from sources,
  and I3 puts sideload app updates there. Sources/Search browse repos the same way the site does. I3 can grow
  `APT_ONLY_TABS`.
- **Two artifacts.** `build.sh [all|deb|ipa]` compiles and links once (`build/Cydian`), then `bundle()` makes each
  `.app`: the .deb's as before (jailbreak entitlements), the IPA's with `entitlements-sideload.plist`
  (`get-task-allow` only) and Info.plist + `Info-sideload.plist` (UIBackgroundModes audio, document types for .ipa,
  .p12, .mobileprovision with an imported UTI for the last, `cydian://` URL scheme, `apple-magnifier` query scheme),
  as docs/sideload.md "What I2 needs" says. No sidedrop signing (R5): ad hoc (ldid/rcodesign if present, else lld's
  ad hoc signature) and the user signs it. `make package` builds both, so `tools/check.sh` gates both where the
  toolchain exists. `make deb` / `make ipa` build one.
- `native/mkipa.py`: reproducible zip (`Payload/Cydian.app/`, sorted, one timestamp, Unix modes so the executable
  stays executable) and `check`: one app, Info.plist keys and overlay present, arm64 iOS 15.0 signed executable,
  entitlements read from the code signature with no `platform-application`/`com.apple.private.*`, no
  `cydian-helper` or `/var/jb/` paths, web files present (including `mode.js`), no tests. `native/test_ipa.py`.

## Decisions (unattended)

- Same bundle id for both builds: sideload tools rewrite it anyway, and nobody installs both on one phone yet.
- The Info.plist keys for features that land later (audio keep-alive, document types) are in now because
  docs/sideload.md lists them under I2; nothing handles them yet (opening an .ipa just launches Cydian).
- The jailbreak .deb doesn't ship the helper yet (that's N3), so today's .deb would also run in sideload mode
  until N3 lands. That's the rule the task gives (mode = helper present), not a bug in I2.

## Tried and failed

- Nothing failed. There's no Swift toolchain or iOS SDK on this machine (`native/build.sh --probe` says so), so
  the real build is skipped by the gate here, as before.

## Not verified

- **The Swift changes compile** (`Mode.swift`, the user script in `App.swift`, `app.info` in `Bridge.swift`) and
  **both artifacts build for real**: no swiftc/IOS_SDK here. `tools/check.sh` builds both where they exist.
  build.sh's new shape was only checked with `bash -n` and `--probe`/bad-argument runs.
- `@_silgen_name` on a body-less `private func` linking to the C symbol: standard practice, but not compiled here.
- No device test (task says so): nobody has a newer jailbroken phone, and the IPA wasn't sideloaded. Whether
  Feather/AltStore/SideStore/TrollStore accept the ad hoc IPA, and whether the .mobileprovision document type
  matches through the imported UTI, are unchecked.
- The web side in a real WKWebView (that the document-start script runs before the module graph): checked only
  under `node --test` with a fresh `router.js?sideload` import.

## Finished on current main (i2-finish)

- Merged onto main after N2/N3, F38 (roothide), F23 (theme bridge), F49 and the 60 FPS preference: main's versions
  of App.swift, Bridge.swift and router.js kept, I2's additions laid on top. build.sh links `spawn.o` and
  `mode.o` into the one executable; only the .deb gets `cydian-helper`; both bundles get `bridge.js`.
- The mode follows main's design instead of a second global: bridge.js has `cydianNative.mode` (`@MODE@`, filled
  in by `Apt.installScript`), which core/settings.js `detectMode()` already read ("site" | "jailbreak" |
  "sideload"). `globalThis.cydianApp = {mode}` is gone (bridge.js sets `cydianApp = true` for haptics), and
  `mode.js` is just `tabsFor` + `APT_ONLY_TABS` on top of `detectMode`.
- The helper path is `Jailbreak.helper` (roothide/rootless/rootful), via `cydian_mode_at` in the bridging header
  rather than `@_silgen_name`. `cydian_mode()` keeps the rootless default for test_mode.py.
- Bundle ID com.ryha.cydian (Info-sideload.plist's URL type name). `mkipa.py check` also wants `bridge.js`.
- Verified: tools/check.sh with the toolchain builds and checks both build/Cydian.deb and build/Cydian.ipa.
