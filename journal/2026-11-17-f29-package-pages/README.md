# F29: package and app pages like Cydia's, with Version History

## The 4S capture

`tools/ui-4s.sh` (lock F29), Cydia 1.1 on iOS 6, `cydia://package/com.a3tweaks.flipswitch` (installed). Saved to
`ref/4s/screens/` (gitignored):

- `cydia-package-top.png`: nav bar "Details" with **Modify** on the right; head card (57pt icon, bold name,
  version in blue, size bottom right in small blue); Change Package Settings and Author rows; the depiction
  (compatibility banner, description); Recent Changes, Twitter rows.
- `cydia-package-mid.png` / `-bottom.png`: the rest of the depiction, **Installed Package** (Version, Filesystem
  Content), and the grey footer `com.a3tweaks.flipswitch` / `BigBoss · System`.
- `cydia-package-modify.png`: Modify opens a UIActionSheet: **Reinstall, Remove, Downgrade**, Cancel.
- `cydia-package-downgrade.png`: Downgrade opens a second action sheet listing the older versions
  (`1.0.16~rc3`, `1.0.16~rc2`), Cancel. Cancelled; nothing was queued (`-after-cancel.png`), then Home, unlock.

## What changed

- `core/catalog.js`: `load()` keeps the versions a Packages file lists besides the candidate (`older`, per id per
  source); `loadAlt()` keeps the full parsed app (every `versions[]` entry) beside the stanza, which still holds
  only the versions this iOS runs. New `history(id, key)` op, and two pure, exported helpers:
  - `aptVersionList(offers, { candidate, installed })`: one entry per version across all sources, newest first
    (Debian order), with the source keys carrying it, size, .deb URL, and `candidate` / `installed` marks. An
    installed version no source offers any more is listed too (keys []), so N4's Downgrade knows where the phone is.
  - `altVersionList(app, ios)`: every versions[] entry in the source's order, each with `runs`, `candidate`
    (newest that runs) and `installable` (http IPA or signed link).
- `web/app/catalog.js`: `catalog.history()` forwarded to the worker (one line; not on the task's file list).
- `nav/actionsheet.js` (new): `showActionSheet({ title, buttons })` → index or -1. Styles in `packages.css`, colours
  sampled from the 4S's `UIAlertSheetDefault*` art (panel, buttons, pressed, cancel) and `UIAlertSheetBlack*` for
  the dark theme. Transform/opacity only (the dim is its own layer). Zoomed 3x render checked: no light lines
  besides the faint highlight under each button, which is in the art.
- `screens/browse.js`:
  - Package nav bar: **Install**, turned into **Modify** once the page knows the package is installed. Opens an
    action sheet. With a backend `queue()` (N4, not there yet) it offers Install / Reinstall, Remove, Downgrade
    (a second sheet of older versions, as Cydia). Without one it offers what works: Downgrade/Other Versions →
    the Version History page, Download .deb on the site, with a one-line title saying where installs happen.
    For AltStore apps: the version's install rows (installRows: Install/Get/Open in…/Download IPA) and Version
    History.
  - Head: the author under the name, a link to their packages (the task asked for icon, name, author, version).
  - Details: a **Source** row (links to the source page unless you're on it).
  - A **Version History** row ("4 versions") → new route token `versions:<id>`, page titled "Versions".
  - `renderVersions`: APT: each version with Latest/Installed tags, size, the sources carrying it; tap → sheet
    (queue install/downgrade when there is a queue; Download .deb on the site). AltStore: each versions[] entry with
    version (build), date, size, iOS range, notes; a version this iPhone runs with a download installs from its
    sheet; the others are greyed with "Needs iOS …" or no button.
- `screens/altstore.js` (not on the file list, small): the inline Version History list on the app page is replaced
  by the row to the new page. Its old `.alt-history*` styles in `altstore.css` are now unused (left, not my file).

## Decisions

- Author/Maintainer stay in their own group near the top (where Cydia has its Author row), not repeated in Details.
- Older AltStore versions install only when they run on this iOS (min/maxOSVersion) and have an IPA; the task said
  "where it has a downloadURL"; installing one the phone can't run would just fail in the sideloader.
- APT history is merged across sources on every page (Cydia's Downgrade list is apt's, also merged); the
  `candidate` mark follows the page's source.
- Screenshots and current-version release notes: AltStore pages already had both (What's New, Screenshots strip,
  F9). APT has no field for either; a Sileo depiction draws its own screenshots and changelog (depiction.js).

## Tests

- `core/versions.test.js` (new): APT version list from `fixtures/versions/repo-a-Packages` + `repo-b-Packages`
  (several versions in one source, the same version in two, a wrong-arch one, ~rc ordering, installed marks, an
  installed version no source offers, installed-only packages); AltStore list from
  `fixtures/versions/altstore-history.json` (needs-newer-iOS, candidate, no-download, needs-older-iOS) and the
  shared F9 fixture's 1.x app; the worker op. `node --test web/app`: 220 pass.
- Chromium walk-through, `tools/serve.py` (fake proxy serving the fixtures) + `tools/shots.mjs` (390x844 3x, iOS
  17.2 UA, Rootless, Flip marked installed via the status upload), light and dark (`THEME=dark`). Kept in `shots/`:
  package page (1), Modify sheet (4), APT Version History (5), app page bottom with its row (8), app Version
  History (9), an app version's install sheet (10). No console errors.

## Not verified

- **On the 4S or any real iPhone**: Cydian's pages were only rendered in desktop headless Chromium; the comparison
  with the 4S capture is by eye from screenshots, not overlaid pixel for pixel.
- **The queue paths** (Install/Reinstall/Remove/Downgrade calling `backend.queue`): no backend has `queue()` yet
  (N4); that branch has never run. N4 should wire to `queue({ op, id, version })` or change these call sites.
- **Download .deb from the sheet** on the site: the click builds an `<a download>` to the proxy; the fake server
  doesn't serve debs, so the download itself was not checked.
- **Native app**: the "install queue isn't in this build" title only shows in the native backend; not run there.
- **Deep link back title**: opening `…/versions:<id>` directly shows the package id as the back button (the name
  isn't known when the nav item is built). Whether the back button reads the name when arriving from a loaded
  package page was not checked.
