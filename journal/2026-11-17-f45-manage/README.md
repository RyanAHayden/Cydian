# F45: Manage replaces Edit on Sources

## What changed

- **Sources tab**: the right nav button is now **Manage** (it was Edit). It pushes `#/sources/manage`. Refresh stays
  on the left. Edit mode and the Add alert moved out of `screens/sources.js`; a left swipe on a row still shows
  Delete. Rows now show in the order set in Manage (`orderSources` + `loadOrder`); with no order saved they stay sorted
  by name, as before.
- **`screens/manage.js`** (new), a grouped page like Cydia's Manage tab:
  - **Sources**: the edit list, always in edit mode: red minus and Delete (reusing sources.css's `.editing`
    classes), **Add** in the nav bar (the same alert as before), and a UITableGrabber on each row. Dragging it
    reorders the rows by transform only, and the order is saved to `localStorage["cydian.sourceOrder"]` when you let go.
    **Sort by Name** forgets the saved order. Sources hidden on Not Jailbroken keep their place in the saved order.
  - **Import & Export**: Share List (`navigator.share` text, else the clipboard), Save as File
    (`cydian-sources.txt`, through the share sheet when it takes files, else a download), Show QR Code (a sheet).
    Import From File (file picker) or From Pasted Text (a text box page, then Next). Both lead to a review page with
    three groups: New (ticked; tap one to leave it out), Already Listed, and Can't Add. **Add** adds the ticked ones
    one at a time, then reports what was added and what failed.
  - **Recommended**: Sources (Add, or Added) and Games. Tapping a game adds its source if it isn't there yet, then
    opens the app's page. Tweak repos are left out on Not Jailbroken.
- **`core/sourcelist.js`** (new, pure): `exportText`/`exportLine`, `parseImport` (formats below), `reviewImport`,
  `entryKeys`, `orderSources`, `loadOrder`/`saveOrder`, `altLink`.
- **`core/recommended.js`** (new): the curated list, the one file to edit, with a `why` on every entry. I checked
  every URL with curl on 2026-11-17, and the game bundle IDs against each source's JSON.
- **`core/qr.js`** (new): a QR encoder (byte mode, versions 1-40, ECC L/M, mask chosen by penalty score, UTF-8 ECI
  for non-ASCII text). I wrote it here because the project uses no libraries and has no build step.
- `manage.css` (new, linked from index.html): the grabber (values sampled from the 4S's `UITableGrabber.png`:
  1pt rgba(0,0,0,.31), 3pt rgba(190,190,190,.68), 1pt rgba(255,255,255,.51), 1pt gap, ×3, 19pt wide), the paste
  box, the QR sheet, and subtitles that wrap.

## Formats

- Export: a `# Cydian sources (N), <date>` comment, then one line per source: its URL, or for a dist repo
  `deb <uri> <dist> <components>`.
- Import reads Cydian's export, plain text with URLs anywhere in a line, `altstore://`/`sidestore://`/`feather://`
  source links, and JSON: an array of URLs, or of objects with `url`/`sourceURL`/`source`/`repository`, under a
  `sources`/`repos` key or at the top level. It also reads an AltStore source file that names its `sourceURL`,
  Sileo's deb822 `.sources` and Cydia's one-line `.list`.
- An AltStore entry gets the `altstore://source?url=` link as its Add input, so Add Source goes straight to
  AltStore even when the URL has no `.json` (apps.altstore.io/), instead of probing it as an APT repo first.

## Decisions (unattended run)

- **Reorder** didn't exist before (the list was always sorted by name), but the brief lists it, so I added it. I
  kept the order in localStorage on the device rather than in the source stores, so the native backend and apt's
  files are untouched.
- **Dist repos** (`deb uri 1800 main`) are exported, but import shows them under Can't Add: both backends'
  `addSource` only takes flat repos and AltStore sources. Filed as a follow-up.
- The QR code carries the same text as the export. A camera shows it as text, so the sheet tells the user to copy
  it into From Pasted Text. A `cydian://` import link would be nicer but needs the app's URL handler (follow-up
  worth considering, not filed).
- Recommended: I didn't describe FIZL0 as anyone's personal source; its reason only names the games.

## Tests and checks

- `web/app/core/sourcelist.test.js` (13 tests): export lines; export → import round trip (every source comes back
  as listed, and each key is among its entry's keys); import into an empty list (new vs Can't Add); pasted
  prose; AltStore link input; Cydia `.list`; Sileo deb822 (with `Enabled: no`); AltStore/SideStore/Feather JSON;
  a missing trailing slash; orderSources/load/save; the recommended list's shape; QR sizes; and a zbarimg decode of
  the default list's export, UTF-8 text and a short URL (skipped where zbarimg isn't installed).
- QR by hand: 24 random texts from 1 to 2300 bytes at L and M (versions 1-40). zbarimg decoded every one.
- In headless Chromium driven over CDP, against the Flask server (screenshots in this folder): Manage, the Sources
  edit list, Import & Export, Recommended, paste → review → Add (ellekit.space and apps.altstore.io really added
  through the proxy), the QR sheet, a drag of the first row down two places (saved, and the Sources tab showed the
  new order), and tapping openMX in Recommended (it opened the app's page).
- What failed along the way: `--virtual-time-budget` screenshots showed empty lists, because IndexedDB never
  settled under virtual time, so I switched to a CDP script with real waits. The QR sheet first drew under the
  sheet's nav bar; it now uses `page-body` like the depiction sheet. zbarimg read UTF-8 as Shift JIS until I added
  the ECI header.

## Not verified

- **On the phone** (the brief's "the user tries it on the phone"): not done. That is the user's step, and this
  task doesn't allow touching the 4S.
- **Dragging with a real finger**: the reorder was tested with synthetic pointer events in Chromium, not touch on
  iOS Safari or WKWebView. `touch-action: none` on the grabber should stop the page from scrolling, but I haven't
  seen it on a device.
- **The share sheet and Save as File on iOS**: `navigator.share` with text or files, and the download fallback,
  can't be exercised headless. Only the code paths are written.
- **A phone camera scanning the QR code**: zbarimg decodes it, but the default list (about 700 bytes, version
  ~22) has not been scanned off a screen by an iPhone camera.
- **The native app** (`backend-native.js`): Manage uses the same `sources/addSource/removeSource` calls, but I
  didn't run it in the app build. Native `removeSource` refuses sources listed in apt's other files; Manage shows
  that error the same way the Sources tab did.
- **Dark theme** of the new page: not screenshotted.
