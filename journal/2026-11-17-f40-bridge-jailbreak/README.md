# F40: the jailbreak shell tells the web app its jailbreak type

## What I did
- `native/bridge.js` carries a `"@JAILBREAK@"` token; when it is `rootless` or `rootful` the script sets
  `cydianNative.jailbreak`. Left unfilled (or junk), the property stays unset, so `bridgeArch()` returns null and
  core/settings.js falls back as before (stored cydian.arch, else rootless).
- `native/Sources/Apt.swift`: `Jailbreak.kind` ("rootless" when the prefix is /var/jb or roothide's jbroot, else
  "rootful"), and `Apt.installScript` replaces the token with it before adding the WKUserScript.
- Chose `jailbreak` over `arch`: the shell knows the jailbreak layout, not the APT architecture, and roothide's
  real arch (iphoneos-arm64e) isn't in core/settings.js ARCHES. The brief maps roothide to rootless, so that is
  what it does.
- Test: `web/app/bridge-jailbreak.test.js` (new file, to keep clear of backend-native.test.js) runs bridge.js in a
  vm with the token filled in as Swift does, and checks `bridgeArch()` reads it; it also checks Apt.swift has the
  replace call.

## Tried and failed
Nothing.

## Not verified
- The Swift change was not run on a phone (no rootless device here; the 4S is iOS 6, not the shell's target). Whether
  it compiles depends on the gate's native build running: if `tools/check.sh` skips it for lack of the
  toolchain, the Swift is compiled by nobody in this task. The change is one `let` and a `replacingOccurrences`.
