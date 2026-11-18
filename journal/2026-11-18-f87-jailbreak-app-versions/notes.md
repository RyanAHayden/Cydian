# F87: I4's real installed-app versions in the jailbreak app

## What I did

- **web/app/app-updates.js**
  - New `rememberedApps({ mode, backend, store })` returns the core/installed.js records. In jailbreak mode they
    first go through `backend.installedApps` (I4), so each has the real `version` plus `remembered`, `actual` and
    `note`. They come back unchanged when the backend has no such call or the call throws.
  - `withAppUpgrades` no longer returns dpkg's upgrades untouched in jailbreak mode. It works out the remembered
    apps' upgrades from the phone's version and leaves out apps that are no longer installed (`actual === null`).
    It merges them with dpkg's rows (dpkg's row wins for the same id; Ignored Upgrades still apply). The sideload
    shell's watch list is not sent from the jailbreak app. If there are no records apart from Cydian itself, the
    same object comes back, as before.
  - `candidates` takes a `lookup` (defaults to `catalog.package`) so tests can supply source rows.
- **screens/installed.js**: the jailbreak app has a new **Apps** page at `#installed/apps` (`APPS`, `pageKind`
  -> "apps"). It is the F30 list with the real versions. Each row's subtitle starts with I4's note. There is no
  version detail and no Upgrade badge for an app that isn't installed (`appListRows`). There is no Install IPAs
  tile (My IPAs is a sideload page) and no self row (dpkg owns that). A row above dpkg's list opens the page, and
  it only appears when there are records. It is added before the virtual list is built, because vlist caches its
  offset.
- **screens/browse.js**: on an AltStore app's page in the jailbreak app, an **Installed App** group
  (`installedAppGroup` / `installedAppSection`) shows Version (the phone's version, or "Not Installed"), with the
  note as its footer. It appears only when Cydian remembers the app.
- **screens/changes.js** (outside the task's file list, two lines): `upgradeJobs` skips `remembered` rows, and
  the Upgrade (N) count is what Upgrade queues. Otherwise Upgrade All in the jailbreak app would hand apt an install
  job for a bundle id (`com.rileytestut.Delta`), and apt would fail the whole Confirm. Those rows still count in the
  tab badge, and tapping one opens the app page.
- Tests:
  - `app-updates.test.js` +4: real versions through createNativeBackend, the fake helper and a `CYDIAN_APPS_DIR`
    tree; updated outside Cydian; no upgrade at the phone's version; gone apps; no records or no installedApps;
    rememberedApps notes and fallbacks.
  - `installed.test.js` +1, `browse.test.js` +1, `changes.test.js` +1.

## Found

- The jailbreak app never writes records. altstore.js renderApp and browse.js recordApp skip recording in
  jailbreak mode, and Mark as Installed is hidden there. So on a jailbroken phone today, everything above stays
  empty: the Apps row doesn't show and Changes has dpkg's rows only. I filed **F88** (after F87) to record the
  helper's IPA installs and offer Mark as Installed there. I didn't do it here because altstore.js and ipa-install.js
  are outside this task's files.

## Not verified

- **On a device: nothing.** The user has no jailbroken phone yet, and the jailbreak app has no records until F88
  lands.
- **The UI was not rendered.** Nothing was rendered in a browser: not the Apps row or page, not the Installed App
  group, not the Changes rows. The tests cover the pure parts only (pageKind, appSubtitle, appListRows,
  installedAppSection, upgradeJobs). The DOM code (load's Apps row, drawApps without the tile, installedAppGroup's
  append) runs in no test, because node has no DOM here.
