# F30 Installed without a jailbreak remembers what you installed

## What changed

- `web/app/core/installed.js` (appended, F7 code untouched): app records kept on the device. `appRecord`,
  `recordInstall`, `removeInstall`, `appRows` (newest first, then by name), `appUpgrades` (a row gets `upgrade`,
  the candidate's version, only when it is newer, by `compareVersions`), `openAppStore` (IndexedDB database
  `cydian-installed`, store `apps`, keyed by app id), `memoryAppStore`, `apps()` (the shared store; falls back to
  memory where IndexedDB refuses, e.g. private mode) and `onAppsChange`.
- `web/app/screens/altstore.js`: `installRows` takes an `onInstall` callback, run before any of Install
  (itms-services), Open in AltStore/SideStore/Feather and Download IPA. `renderApp` passes one that records id
  (bundle id), name, version, catalog key, source URL, source name and icon, except in jailbreak mode.
- `web/app/screens/installed.js`: site and sideload build: the root is the recorded apps, newest first. Each row
  shows the source and date, the version (or an Upgrade badge plus "Upgrade to x" when a source has a newer one),
  and opens the app page while a source still has the app. Edit (red minus, then Delete) or a left swipe removes a
  row, the same controls as the Sources tab. On the site, a "Jailbroken iPhone" row at the bottom chooses the dpkg
  status file, then opens its package list at `#installed/dpkg` (title "dpkg Status", Load on the right).
  Jailbreak mode: unchanged F7 (`pageKind` says "dpkg" at the root).
- Tests: `core/installed-apps.test.js` (record and replace, newest-first order, upgrade detection with newer, equal,
  older and gone candidates, removal and listeners, no IndexedDB) and `screens/installed.test.js` (which page each
  mode and route gets, the row subtitle).

## Decisions (unattended)

- **Which taps count as installing.** The site and sideload build can't see what the phone has, so all three install
  rows record: Install, Open in a sideloader, Download IPA. Recording too much is fixed with one swipe. Missing a
  real install can't be fixed at all.
- **Upgrade = catalog candidate.** "A source has a newer version" uses `catalog.package(id, ALL)`, the newest version
  on any source that this iPhone runs (F9's rule). An app no source carries any more stays listed, with no badge
  and no link.
- **The site keeps both.** Apps are the root on the site because most visitors aren't jailbroken. The status-file
  upload moved one row down rather than going away. The Installed root used to be the dpkg list on the site.
- **Reused `.source-row` styles** (sources.css) for the delete controls instead of copying the CSS, so this task
  touches no CSS file. The rows also carry `installed-app`, which the gestures key on.
- Records are keyed by app id: installing the same app again replaces its version and date.

## Checked in Chromium

The walk-through script is `tools/shots.mjs`; `tools/serve.py` and `tools/cdp.mjs` are copied from F9. It runs
headless Chromium at 390x844 3x with an iOS 16.5 user agent, against the F9 fixture AltStore source. Shots are in
`shots/`:
1. empty tab: the note, and the Choose Status File row;
2. after tapping Download IPA on Emu's page: Emu 1.5 · Example Apps · today;
3. an older Legacy 1.0 record: listed below Emu (older date) with Upgrade, "Upgrade to 3.1";
4. Edit: red minus on the app rows only, Done in blue;
5. a row armed with Delete;
6. after Delete: Emu gone from the list and from IndexedDB;
7. `#installed/dpkg` with no status file: the F7 upload prompt.
No console errors.

## Failed along the way

- The walk-through's first Edit selector clicked a hidden copy of the Sources tab's Edit button. The fix was to
  select the button in `.nav-stack.is-active`. That was a bug in the script, not the app.

## Not verified

- **The sideload build (I2) and Safari on a real iPhone.** No device run: the sideload build doesn't exist yet, and
  this task doesn't touch the 4S. The mode logic is covered by the `pageKind` tests and the Chromium run (site mode).
- **The IndexedDB store against a real IndexedDB in node.** Node has no IndexedDB. The tests use `memoryAppStore`
  (same interface), and the real store was exercised only in Chromium.
- **Whether the record lands before iOS leaves for itms-services or a sideloader URL scheme.** These links hand off
  without unloading the page, so the write should finish, but that was not tried on an iPhone.
- **The site with a status file loaded.** The dpkg list at `#installed/dpkg` reuses F7's loader unchanged; only the
  empty prompt was shot.
