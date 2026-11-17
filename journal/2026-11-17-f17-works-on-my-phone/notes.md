# F17: "Works on my phone"

## What I did
- `web/app/core/compat.js` (new, pure): the verdict per package for a device `{ ios, jailbreak }`.
  - Architecture: `iphoneos-arm64` rootless, `iphoneos-arm` rootful, `iphoneos-arm64e` roothide, `all` any; none =
    rootful (old repos, as core/apt.js matchesArch says); anything else (`darwin-arm64`) is "Not for iPhone".
  - iOS: `Depends`/`Pre-Depends: firmware (op v)` ANDed across groups; an alternative group counts only when every
    alternative is `firmware` (else it can't be judged and is skipped). I also read `Conflicts`/`Breaks: firmware
    (>= 15.0)`, which real repos use to rule out newer iOS. AltStore apps: `minOSVersion`/`maxOSVersion` (camelCase
    or lower-cased); a max of "17" lets any 17.x in. Apps suit any jailbreak type and phones with none; a deb on a
    phone with no jailbreak ("none", the sideload build) is "Jailbreak only".
  - No iOS statement → "unknown", and unknown is never filtered. A known range with no known iOS version → unknown too.
  - `iosFromUserAgent`: `iPhone OS 16_5` → "16.5". Safari 26 freezes that part at 18_6, so a `Version/26+` wins.
  - Codes per row: works / unknown / ios / rootful / rootless / roothide / jailbreak / arch; `badge()` turns them into
    "Works", "Not on iOS 16.5", "Rootful only", "Unknown"…
- `core/catalog.js`: `setDevice(device, { filter })` (also a worker op). Every row carries `compat`; with the filter
  on, rows that can't work drop out of sections (counts too, and a section with nothing left disappears), lists,
  search and author, the same way hidden sections do. The package page and `has()` still find them. Rows loaded
  later are judged on load.
- `catalog.js` (UI): `setDevice`, sent to the worker ahead of the next question like `setHidden`.
- `device.js` (new): the device. iOS version: Settings > iOS Version on the site (Automatic = the user agent), the
  bridge's `app.info` `ios` in the app (the UA until it answers). Jailbreak type: the existing Architecture setting;
  the sideload build is "none". `filterRow()` is the "Works on My Phone" switch row with "iOS 16.5 · Rootless" under it.
- Settings (`core/settings.js`): new section "Works on My Phone": a toggle (all modes, on by default) and an iOS
  Version list (site only: Automatic plus every minor from 12.0 to 26.3, `IOS_VERSIONS` in compat.js). Feature
  `compat` added to FEATURES; settings tests updated for the new rows.
- UI: a badge beside the name in every package row (`.pkg-compat` in packages.css), a badge under the version on the
  package page plus a "Works on My Phone" group whose footer says why ("Made for iOS 15.0 or later."). The switch row
  sits above the Sections list and under Search's bar; flipping it, or changing the iOS version or Architecture in
  Settings, redraws those pages and updates the row's line.
- Tests: `core/compat.test.js` (every Depends/Architecture combination, no-firmware packages unknown and not
  hidden, alternatives, Conflicts/Breaks, apps, unknown iOS, user agents), a catalog test for setDevice and the
  filter, `device.test.js` (where the device comes from), a settings test for the new rows.

## Checked in Chromium
Headless Chromium with an iOS 16.5 Safari user agent against `web/app.py` on a spare port, real network, default
sources (drive.mjs/cdp.mjs from the F5 journal; scripts in `tools/`, shots in `shots/`):
- All Packages: 683 with the filter on at iOS 16.5, 428 at iOS 13.0, 696 with it off.
- Rows show Works / Unknown; with the filter off at 13.0, "Not on iOS 13.0" in red (`shots/search.png`).
- 5Row Pro (`firmware (>= 15.0)`) at iOS 12.0: "Not on iOS 12.0" on its page, footer "Made for iOS 15.0 or later."
- Changing the iOS version and flipping the switch in Settings updated the Search tab's row and results.
- No console errors.

## Decisions (unattended, no one to ask)
- The arch filter at load (F5: lists go through filterArch) stays. So with the existing settings a rootful package
  never reaches a rootless list and "Rootful only" shows only where a row wasn't dropped first. The core still judges
  Architecture fully, ready for F37's Device type and for F9's apps.
- The jailbreak-type half of the picker is the existing Settings > Architecture row (the footer points to it), not a
  second setting: F37 replaces that row with Device type, and two settings for one thing would disagree.
- The filter is one setting shared by the Sections page, every list under it and Search, rather than a switch per list.

## Tried and failed
- Put the switch inside the row's link (to open Settings from the row). A button inside an `<a>` is invalid and the
  tap follows the link, so the row is plain, with no link.
- First package page draft put the range both under the label and in the footer; that read twice, so only the footer
  says it.

## Not verified
- On a real iPhone (Safari or the app's WKWebView): only headless Chromium with a faked user agent. The 4S runs iOS 6,
  and this task doesn't ask for the device.
- The app's bridge path (`app.info` → iOS version): no native build or device here. The code only reads a field
  Bridge.swift already returns.
- Safari 26's frozen `OS 18_6` user agent: written from what Apple announced; no iOS 26 browser to check against.
- Roothide: the core judges `iphoneos-arm64e`, but nothing sets a device to roothide yet (Settings offers only
  Rootless/Rootful, and app.info doesn't report the jailbreak type). Filed as a follow-up.
- AltStore apps: judged by the core and tested, but there are no app lists in the UI yet (F9), so no badge on one.
- Dark theme badge colours: written, not looked at in a shot.
