# F51 Changes tab by day

## Done
- `core/changes.js`: `dayGroups(records, rows, { now, days: 7 })` groups by local day (Today, Yesterday, then
  "Saturday, November 14": `dayTitle`), last 7 calendar days (today + 6, DST-safe by calendar), newest first, rows
  newest first within a day. A record's time is its `date` (the source's) or `first` (when a refresh saw it).
  Cydia's first-load rule now works per record: undated records stamped by the very first refresh are the archive
  and don't count (dated AltStore records do, so a fresh install still shows this week's AltStore releases).
  Future dates count as today. `filterRows`/`filterGroups` (search: every word in name/id/description/author,
  case-insensitive; scope Installed: ids in a Set), `defaultScope(count)`.
- Records gain an optional `date`. `newRecords` takes `[key, id, version, date]`; `recordRefresh` reads the
  whole store (a Map) so a record filed before F51 without a date gets its date on the next refresh.
- `core/catalog.js versions()`: AltStore apps file every runnable versions[] entry with its date, so an app with an
  older version listed shows as Updated, and its newest version files under its release day. (One function,
  outside the brief's file list, but the only way the dates reach the store.)
- `catalog.js changes()` returns `dayGroups` (was `changeGroups`; `changeGroups`/`groupTitle` are left in place,
  unused by the UI, still tested).
- `core/installed.js installedIds(dpkgRows, appRecords)`: union of the status file's packages and the apps
  recorded on the device (F30).
- `screens/changes.js`: Search's grey bar + scope bar (same CSS classes, no Filter button) with All / Installed.
  Default scope Installed when anything is installed, else All; a tap holds for the session. Typing and scope taps
  redraw from the last load (no worker round trip). Upgrades stay on top; the scope never hides them (they are
  installed), the search does filter them. Empty text depends on search/scope.

## Decisions
- Date format for older days: weekday + month + day (no year; the window is 7 days).
- Scope pick is per session, not persisted (the brief asks for the default to follow installs).

## Tests
- core/changes.test.js: day grouping, 7-day window, AltStore dates (incl. first load, future, outside window),
  dating old records, search filter, default scope with/without installs. screens/changes.test.js: headers,
  Installed scope + upgrades on top, search, scopeOf. Ran under TZ LA, Kiritimati, London, UTC: pass.

## Not verified
- The tab with real data in a browser: headless Chromium on a static server drew the search and scope bars
  correctly (Search's look), but the list stays on "Loading Changes" there because a static server has no Flask
  fetch proxy, and I didn't set up the venv + Flask for a screenshot. The user tries it (as the brief says).
- On the device (4S / app): not touched; the task doesn't say to.
- With no data loaded yet, neither segment shows as selected until the first load works out the default.
