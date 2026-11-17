# F38: Roothide as a jailbreak type

## What I did
- `native/Sources/Bridge.swift`: `app.info` now also returns `jailbreak`, from a new `Jailbreak.type` (an extension
  in Bridge.swift, so Apt.swift stays untouched): "roothide" when libroothide's `jbroot` resolves through
  `dlsym(RTLD_DEFAULT)` (the same test Apt.swift's prefix uses), "rootless" when the prefix is /var/jb, "rootful"
  when /var/lib/dpkg/status exists at /, else "none" (the sideload build on a stock phone).
- `web/app/core/apt.js`: `ARCHES` gains `iphoneos-arm64e`; `matchesArch` needed no change (it compares exactly).
- `web/app/core/settings.js`: Device offers "Jailbroken (Roothide)" (iphoneos-arm64e), the hidden `arch` setting a
  "Roothide" option (the module's own asserts require both to cover ARCHES), `bridgeArch` maps `roothide`.
- `web/app/device.js`: `applyNativeJailbreak(info, settings)`: in the jailbreak build only, app.info's type is
  written to `arch` (deviceType() and getArch() read it); the change reaches the catalog through settings.onChange.
  The site keeps the visitor's choice; the sideload build stays Not Jailbroken.
- `web/app/screens/settings.js`: no change needed; the Device list renders from the options.
- Tests: settings (Device labels, roothide on site and from the bridge), device.js (roothide judged, applyNativeJailbreak
  per mode), apt (arm64e filter).
- Filed D2 (low): the help page in screens/home.js (not on my file list) still names only Rootless and Rootful.

## Decisions
- Roothide lists only iphoneos-arm64e and `all` packages. Roothide's Bootstrap can convert arm64 rootless debs,
  but apt on roothide lists arm64e, so that's what Cydian lists too.
- The app sets `arch` asynchronously after app.info. The first launch on a roothide phone lists rootless packages
  until app.info replies, then switches; later launches start with the stored arch.

## Not verified
- On a real roothide (or rootless/rootful iOS 15+) phone: none available; the 4S is iOS 6. Whether `jbroot` is
  visible to `dlsym(RTLD_DEFAULT)` in Cydian's process depends on roothide injecting libroothide, the same
  assumption Apt.swift's prefix already makes.
- The Swift change compiles only if the gate's native build runs here (`native/build.sh --probe` passed, so
  `tools/check.sh` builds it); no device run of the build.
