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
- Not run on a phone: there is no rootless device here, and the 4S runs iOS 6, which the shell doesn't target. So the
  injected value on a real Dopamine/roothide/rootful device is unchecked. The Swift does compile: `native/build.sh
  --probe` passes on this machine, so the gate's `make -C native package` built it.
