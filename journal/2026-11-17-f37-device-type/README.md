# F37 Device type, Not Jailbroken by default on the web

## What changed
- **core/settings.js**: a new Device section. `device` (site only; Not Jailbroken / Jailbroken (Rootless,
  iphoneos-arm64) / Jailbroken (Rootful, iphoneos-arm), default `none`) replaces the Architecture row. `arch` stays
  as a setting with no row (`modes: []`) so backend.js getArch() keeps reading `cydian.arch`. Picking a jailbroken
  type also sets `arch`, and listeners hear both. `deviceType()` / `jailbroken()`: site = the Device setting,
  sideload = always `none`, jailbreak app = the bridge's detected type (`bridgeArch`: `cydianNative.arch` or
  `.jailbreak`), else the stored arch, else rootless. A site visitor who had set `cydian.arch` before keeps it as
  their type (one-time copy). `sideloader` (site only): Feather (default) / AltStore / SideStore / Download .ipa.
- **device.js**: `deviceFrom({ type })`. Not Jailbroken gives jailbreak `none`, so core/compat.js badges debs
  "Jailbreak only". `DEVICE_KEYS` adds `device`.
- **core/catalog.js**: a device with jailbreak `none` sees `alt:` sources only. APT packages drop out of sections,
  lists, Search (exact matches too), author, package(), has() and upgrades, whether Works on My Phone is on or off.
  `versions()` is left alone, so Changes doesn't file debs as new when the type flips.
- **catalog.js**: while Not Jailbroken, APT sources aren't fetched at all. Leaving `none` resets `first`, so they
  load before the next question (checked live: Rootless shows debs without a reload).
- **core/sources.js `sourcesFor`** + **screens/sources.js**: the Sources tab hides APT sources while Not Jailbroken
  and says how many are hidden, pointing to Settings > Device.
- **screens/home.js**: the hint "Showing apps for iPhones without a jailbreak. Jailbroken? Settings > Device." under
  the welcome, linking to `#/settings/device`. It isn't shown in the sideload build, which has no choice to make. The
  Help page's Which Jailbreak lists Not Jailbroken.
- **core/altstore.js `sideloaderLink`** + **screens/altstore.js**: the app page's Install group starts with Get. It
  goes to `feather://install/<ipa>` (from Feather's FeatherApp.swift handler), `altstore://install?url=`,
  `sidestore://install?url=`, or downloads the IPA, always the source's own URL. Rows with itms-services links keep
  F9's signed Install. In the sideload build no sideloader is picked: F14 signs there.
- search.js redraws on `device` too.

## Decisions (unattended)
- Device is a pushed list (like iOS Version), not three inline rows, so each type can have a subtitle.
- The Sideloader setting is shown on the site only. The sideload IPA signs on the phone (F14), and the jailbreak app
  doesn't install IPAs through a sideloader.
- The F35 journal said F37 "already follows from F17's verdict". It doesn't fully: Show Incompatible and Search's
  exact-match exception both brought debs back. The catalog filter is now hard, and separate from compat.

## Tests
`node --test web/app`: all pass. New: settings (defaults per mode, bridge type, arch sync, migration, row visibility,
Sideloader), catalog (Not Jailbroken = apps only with the filter on and off; rootless vs rootful packages; switching
back), sources (`sourcesFor`), home (`deviceHint`), device (`type`), altstore (`sideloaderLink`).

## Checked in Chromium
`tools/serve.py` is a fake `/api/fetch`: the F9 AltStore fixture plus a fake flat APT repo with arm64, arm and `all`
debs. `tools/shots.mjs` runs headless Chromium 390x844 @3x with an iOS 16.5 user agent. Shots are in `shots/`:
- `1-home-not-jailbroken`: the default, with the hint; `7-home-rootless`: no hint.
- `2-search-not-jailbroken` ("example"): Emu, Legacy, Signed only. `8-search-rootless`: plus Spring Tweak, Dark
  Example Theme, Example Util. `9-search-rootful`: Old Example Tweak and Example Util plus the apps.
- `3-sources-not-jailbroken`: only the AltStore source, plus "6 APT sources are hidden…".
- `4-settings`, `5/6-device-page`: tapping the hint lands on #/settings/device; picking Rootless works live.
- `10-app-page-get`: Emu's Install group starts with "Get — Opens in Feather…". No console errors.

## Failed along the way
- The first `sideloaderLink` test used a URL with a space. F9's `httpUrl` rejects those, so the test now uses `%20`.
- The Not Jailbroken subtitle was cut off on the Device page and was shortened.

## Not verified
- **The sideloader URL schemes on a real phone.** Feather's `install/<url>` form was read from its source
  (FeatherApp.swift on GitHub, main branch). AltStore's and SideStore's `install?url=` come from their documented
  scheme, but I haven't opened any of the three on an iPhone. Driving the 4S isn't part of this task, and it runs
  iOS 6 anyway.
- **The jailbreak app's detected type.** No shell sets `cydianNative.arch` / `.jailbreak` yet; filed as F40. Until
  then the app uses the stored `cydian.arch`, or rootless. The native build wasn't run here.
- **The home-screen web app (standalone PWA)** wasn't launched. It runs the same code with mode "site", so it
  defaults to Not Jailbroken.
- **Dark theme shots** weren't taken. The hint uses the footer's `--head` and `--emboss` variables, which already
  have dark values.

## Follow-ups filed
- F40: the shell reports its jailbreak type (native/bridge.js, Apt.swift).
- B6: F9's `feather://source?url=` should be `feather://source/<url>`.
- F41 (low): Refresh skips the hidden APT sources while Not Jailbroken; hide Search's Tweaks/Themes segments and
  Home's Themes tile there.
