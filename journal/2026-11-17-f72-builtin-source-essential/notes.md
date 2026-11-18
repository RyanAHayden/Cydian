# F72: Cydian's own built-in source and the Essential Upgrade alert

## What I did

- **Release side.** `tools/selfrepo.py` (new) writes a flat APT repo (`Packages`, `Packages.gz`, `Release`, with
  MD5/SHA256) over the Debian-named .debs. `tools/release.sh` runs it on every release and uploads the three files
  as release assets beside the .debs. Other-arch builds found in `--dist` as `com.ryha.cydian_<ver>_<arch>.deb` go
  along too. New flags: `--minimum X.Y.Z` (X-Cydian-Minimum-Version in the Release and Cydian's stanza,
  `"minimumVersion"` on the app in the AltStore JSON; refused if newer than the release) and `--out DIR` (keeps the
  files; a dry run writes the AltStore source there only). `tools/altsource.py update` now keeps `versions[]`
  history (newest first, at most 20), takes `--notes` (first lines become the version's description) and
  `--minimum`, and accepts `--source` for another path.
- **Hosting decision** (docs/release.md, "Cydian's own sources"): the APT repo is
  `https://github.com/RyanAHayden/Cydian/releases/latest/download/`, made of release assets. I chose that over
  GitHub Pages: the URL is stable, there is no branch or Pages setup to keep up, and the .debs stay out of git.
  `Filename:` is the bare asset name, which resolves to the same release. The AltStore source stays at I7's raw
  `main/web/app/source.json`.
- **Built-in source** (`web/app/core/essential.js`, new): `builtinSources(mode)` gives the APT repo in the jailbreak
  app and the AltStore source in the sideload app and on the site. On the site it is built in for every device type,
  not only Not Jailbroken, because the site only installs IPAs. `withBuiltins`/`applyBuiltins` wrap the
  backend's source calls (in `backend.js` getBackend):
  - the built-in is always listed, first, marked `builtin` (a seed record until it has been read);
  - `removeSource` refuses it with a BuiltinError;
  - `refreshSources` adds it back through `addSource` if it isn't stored (in the jailbreak app that writes it into
    cydian.sources through the helper, F33).

  The screens: Sources shows a lock after its name and no swipe Delete. Manage's edit list shows a lock where the
  minus goes, no grabber, and nothing can be dragged above it. Export and Copy URLs skip it (`exportable`). The lock
  is an SVG in `nav/lock.js`, placed by `sources.css`.
- **Minimum on the record**: `core/sources.js` verifySource/refreshSource save the Release's X-Cydian-Minimum-Version
  as `minimumVersion`.
- **Essential Upgrade** (`core/essential.js` runEssential and essentialAlert, wired in `essential-ui.js`, started
  from `app.js` in place of F61's launch popup):
  - Jailbreak: `catalog.upgrades` + dpkg's status (`Essential: yes`) + `ESSENTIAL_IDS` (com.ryha.cydian, which
    holds the helper, plus apt and dpkg). The minimum comes from the built-in record. The buttons queue jobs (N4),
    and Confirm opens.
  - Sideload: reads Cydian's AltStore source once per launch (`selfFromAltSource`: only bundle id com.ryha.cydian),
    caches it, and Changes shows Cydian's own row from that cache (`upgradesWithSelf`). Changes in the sideload app
    has no other upgrades (they come from dpkg), so Complete Upgrade and Essential Only both install Cydian.
  - Below the minimum the alert has no Ignore, Escape does nothing, and a clear block over the screens and tab bar
    (z-index 10, under the HUD, sheet and alert) asks again when tapped.
  - If the built-in source can't be read ("unknown"), F61's GitHub check runs as before.
- **Cydian's own IPA never uses the local server** (`installSelf`). It signs on the Signing Server
  (`getServer()`), after asking once per host and saying the key goes there for that one request, then opens the
  itms-services link. With no certificate it can send, it explains why in plain words and offers cydian.dev's
  Install Cydian App. The same path is used by `signing-client.js` signAndInstall for any
  github.com/RyanAHayden/Cydian/releases IPA (Cydian's package page, Settings' Install Cydian App) and by F61's
  Check for Updates Install (`selfupdate.js` installSideload takes `installSelf`).
- **Native**: `app.openURL` in Bridge.swift (https and itms-services only), so the web view can open those links.
  The JS falls back to `location.href` on an older shell.
- **Tests**:
  - `web/app/core/essential.test.js` (28 tests): built-in always present, first, not removable, not exported,
    re-added on refresh; the minimum and version compare; essential detection; each button; forced mode drops
    Ignore; installSelf's paths; the committed source.json reads.
  - `tools/test_release.py`: repo files, hashes, minimum field, the AltStore JSON history and notes, `--minimum`
    validation, other arch.
- Looked at a 3x headless Chromium render of both lock placements (name lock in Sources, left lock in Manage's
  edit list) on a scratch page built with `nav/ui.js` plain() and the real CSS. The scratch page is deleted.

## Tried and dropped

- Loading `#/sources` in headless Chromium showed an empty list (the backend never resolved under
  `--virtual-time-budget`). I used the scratch page with real rows and CSS instead.
- Exporting the identity for the Signing Server: the sideload app imports the .p12 into the Keychain and keeps
  neither the file nor the password, so there is nothing to export yet. `essential-ui.js` calls `signing.export`,
  which doesn't exist, and always takes the cydian.dev path for now. Filed **F73** (native signing.export).

## Decisions

- Site: the AltStore source is built in for every device type, not just Not Jailbroken.
- Sideload Complete Upgrade = Essential Only (Changes there holds only Cydian's own upgrade).
- Jailbreak essentials: com.ryha.cydian (the helper is in the same package), apt, dpkg, plus any installed package
  with `Essential: yes` in dpkg's status.
- One prompt: in the app the launch runs the Essential check, not F61's popup. F61 only runs when the built-in
  source couldn't be read. Settings > About's Check for Updates is unchanged.
- `minimumVersion` sits on the app entry in the AltStore JSON (the source-level one is read too).

## Not verified

- **The user updating from an older release on their iPhone** (the brief's device test, and "test with the
  testrepo's Cydian 0.1.1.1"). No device in this session, and the task says only the user's iPhone can do it.
- **The Signing Server path end to end.** It needs F73's `signing.export`. Until then the sideload app always
  offers cydian.dev, so the server POST in `essential-ui.js` signOnServer runs only in the unit tests, through a
  fake.
- **`app.openURL` on a device.** The gate compiles the native build; nobody has tapped it.
- **apt with the GitHub-hosted repo.** apt following GitHub's 302 to objects.githubusercontent.com, and accepting an
  unsigned flat repo, is not checked. No real release was published (the task says never publish).
- **Jailbreak launch gather** (catalog.ensure + dpkgStatus at launch) and the Confirm sheet opening from the alert:
  no jailbroken device was driven. The 4S is iOS 6 and can't run the app.
- **The forced block's feel** (a tap anywhere asks again) was not seen on screen. Only its logic is tested.
- **Live AltStore clients ignoring `minimumVersion`**: assumed from AltStore's JSON decoding (unknown keys are
  dropped). Not tried in AltStore or SideStore.
