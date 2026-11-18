# F128 Settings audit

The full before/after list (what went, what moved, why) is in `docs/settings.md`.

## What I did
- Listed every `SETTINGS` entry and every row `screens/settings.js` draws, for each build, and grepped `web/app`,
  `native/` and `worker/` for anything that reads each key.
- Removed five settings that nothing reads: `sideloader`, which was hidden, and `checkUpdates`, `cellular`,
  `notifications` and `badge`. The last four were never shown because their features never shipped.
  - `createSettings()` runs `dropRetired()`, which deletes their stored `cydian.<key>` values.
  - `checkUpdates` and `cellular` were daemon keys. They left `DAEMON_KEYS`. A full `daemonPrefs()` now sends them as
    `null` (`RETIRED_DAEMON_KEYS`), so the shell removes any old value and the daemon keeps its own defaults (Daily,
    cellular on).
  - `web/app/settings.test.js` still passes unchanged: it expects `cydian.checkUpdates` to be null.
  - `native/Sources/Bridge.swift` still accepts both keys. I left it alone: accepting a null is harmless, and the file
    isn't on this task's list.
- Laid out the screen like iOS 6. `PAGES` (General, Display, Updates, Signing) and `SECTIONS` now carry a `page`.
  `settings.pages()` gives each page with the groups this mode shows, and `pageOf(id)` looks one up.
  - The root is short rows only: Cydian Account; General, Display, Updates; Signing (the certificate as its detail);
    the action rows owned by other files (Open in Cydian App, Install from URL, Console Logs); About (the app builds).
  - Re-sign Reminder moved onto Settings > Signing. Update Alerts (sideload) moved to Updates. Open Other Apps' Links
    moved to General, with a shorter footer.
- Renamed some labels: Allow Zoom → Zoom, Show Compatibility Marks → Compatibility Marks, Only When Charging and
  Locked → When Charging and Locked. The last one was cut off in a 390 px render. Footers are now one short line each.
- Kept every behaviour the user relies on, including Allow Zoom: the user's own commit added it (bc30850).
- Routes:
  - The new ones are `general`, `display`, `updates`, `<page>/<key>`, `<page>/holds`, `signing/<key>` and `about`.
  - The old one-segment `device`, `iosVersion` and `holds` still work, because Home's hint, a package's
    "Set iOS Version" and mounted links use them.
- Tests:
  - `core/settings.test.js`: defaults of every remaining setting, the exact list left, the migration (including
    storage without `removeItem` and storage that throws), the page layout per build, a footer length cap, and
    `daemonPrefs` with the retired keys.
  - `screens/settings.test.js`: page titles for the new routes and the old ones.
  - Updated the old expectations that named removed settings or the old section order.

## Tried / found
- I didn't create `web/app/settings.css`, although the task's file list names it. The pages use only the existing
  grouped table and switch styles, so a stylesheet would be empty and would mean editing `index.html` (not on the
  list). Icons on the root rows, like iOS 6's 29 px tiles, would need it. I left them out, so as not to invent
  artwork.
- Screens checked in headless Chromium at 390 px:
  - Website: root, General, Display, Updates, General > Device.
  - Jailbreak and sideload: the same pages with a fake `cydianNative` injected through a copy of `index.html` in the
    scratchpad, plus Signing and About.
  - All drew as intended. The jailbreak Updates page showed the cut-off "Only When Charging and Lock…" label, which
    the rename fixed. A second render shows "When Charging and Locked" in full, with its footer.

## Not verified
- The iPhone: no phone for this task. The task says the user checks Settings on the iPhone.
- The real daemon removing `cydian.checkUpdates` and `cydian.cellular` when sent as null: this relies on
  Bridge.swift's documented "null removes the key". No jailbreak phone run.
- The root still shows group headers and footers drawn by other files (Open in Cydian App, Install IPA, Console).
  I left them alone so those files stay untouched. Two stale comments also stay: `web/app/settings.js` mentions
  "Settings > App Icon Badge", and `core/selfupdate.js` names `aboutSection`.
