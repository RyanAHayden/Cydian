# F35: Search filters and compatibility marks

## What I did
- `core/catalog.js` `search(query, filters)`: optional `section` (a section name, or `group:Tweaks|Themes|Apps|Utilities`
  from the new `SECTION_GROUPS`/`sectionGroup()`, matched on the simple section name), `source` (a source key: that
  source's own rows and versions), `installed` (`installed` | `not`, from dpkg's status file), `price` (`free` | `paid`,
  from `cydia::commercial`; rows now carry `paid`). Hidden sections stay out as before.
- Default compatibility filter + exact-match exception: with Works on My Phone on (F17's setting, the default), rows
  that can't work drop out of Search, except one whose name or id equals the query; that row comes back with
  `exact: true` and `why` (`needText()` in compat.js: "Needs iOS 15 or earlier", "Needs a rootful jailbreak", ...).
- `core/compat.js`: `markOf(code)` -> works | no | unknown | null, `needText(verdict)`.
- Installed rows (`installed()`, installed-only pages) now carry `compat` too, so the Installed list gets marks.
- `screens/search.js`: iOS 6 scope bar under the search bar (segments All / Tweaks / Themes / Apps from UISegmentBar's
  pixels, plus a Filter button). The Filter sheet (nav/sheet.js): Show Incompatible switch, Clear Filters (when any
  is set), Installed, Price, Source, Section (All <group> rows, then every section). Filters last for the session.
  The page reruns the search when Show Incompatible, iOS version or Architecture change anywhere.
- `screens/browse.js`: every package row's F17 text badge became a mark (`.compat-mark[data-mark]`, SVG circles:
  green check, red X, grey ?); the package page draws a larger mark beside the name (the text badge stays under the
  version there). Search's exact incompatible row: name red (`.pkg-name.incompatible`), reason as the subtitle.
- Settings: "Show Compatibility Marks" (compat section, all modes, on). Off sets `html[data-compat-marks="off"]`, which
  hides every mark with CSS, so binding rows while scrolling never reads the setting.
- `web/app/catalog.js` (one line): `catalog.search(q, filters)` forwards the filters.
- Tests: catalog (filters; default filter + exact name/id exception, Show Incompatible), compat (mark per verdict,
  reason texts), settings (new row), `screens/search.test.js` (segments, filter object, which segment is lit).

## Decisions (unattended)
- Show Incompatible is the existing `worksOnMyPhone` setting turned round, not a second setting: Sections, Search and
  Settings must agree. Search no longer shows F17's Works on My Phone switch row; the sheet has it. Sections keeps it.
- Four segments + Filter: five segments plus a button don't fit 320 pt. Utilities and every other section are in the sheet.
- The row mark replaces F17's row text badge (both would crowd the name). The reason in words is on the package page,
  and on Search's exact-match row.
- The exact match keeps its red name and reason with Show Incompatible on too (other incompatible rows show only
  their X and description): the row someone typed the name of always says why it won't install.
- F37 (Not Jailbroken shows apps only): already follows from F17's verdict, debs are "jailbreak" on a `none` device
  and drop out by default; Show Incompatible brings them back in red X. Nothing F37-specific added.

## Checked in Chromium (headless 155, 390x844 @3x, real network, `web/app.py` on a spare port)
Script `tools/f35.js` / `tools/f35-dark.js`, run with `journal/2026-11-17-f5-packages/tools/drive.mjs`; shots in `shots/`.
- iOS 16.5: "flex" -> rows all with green checks; Themes segment -> "No Results"; "theme" + Themes -> themes with grey ?.
- iOS 13.0: "5row pro" -> 5Row Pro, red name, red X, "Needs iOS 15.0 or later"; "5row" (not exact) -> nothing.
- Sheet: Show Incompatible on -> `worksOnMyPhone` false, "5row" shows 5Row Pro with its description and an X.
- Package page: mark beside the name. Settings page shows the new row. Marks off -> 0 marks visible. No console errors.
- Light and dark: `search-*.png`, `exact-incompatible-*.png`, `filter-sheet-*.png`, `package-*.png`. Dark first had a
  blue divider beside the selected segment; fixed (black dividers in dark).

## Tried and failed
- First probe counted vlist's pooled hidden rows (they stay in the DOM with `hidden`) and showed stale results; the
  app was right, the probe now reads `.pkg-row:not([hidden])`.

## Not verified
- On a real iPhone (Safari or the app): headless Chromium only; the task doesn't ask for the device.
- Installed / Not Installed against a real status file in the browser: covered by the catalog test only (no status
  file uploaded in the headless profile).
- Paid filter on live data: unit-tested only; I didn't look for a paid package in the live run.
- The sideload build's apps-only Search (F37): no app lists in the UI yet (F9) and no sideload build here.
