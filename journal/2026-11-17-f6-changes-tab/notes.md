# F6: Changes tab

## What I did

- `web/app/core/changes.js` (new, pure plus a thin IndexedDB wrapper, database `cydian-changes`, store `seen`):
  one record per (repo, package, version) `{k, key, id, version, first}`. `recordRefresh(store, triples, now)`
  adds every triple not seen before, all stamped with the same `now`, so a repeat refresh adds nothing.
  `changeGroups(records, rows)` works out Cydia's per-package `{first, last}` as minimums over repos, as
  docs/cydia.md suggests:
  - `first` = the earliest record of the id;
  - `last` = the earliest record of its current candidate version.

  It then groups by `last`, newest first, and drops the oldest group (Cydia's rule: the first load). Rows are
  marked `updated` when `last > first`, otherwise `new`.
- `core/catalog.js`: a `versions` op that returns `[key, id, candidate version]` for every source, run in the
  worker.
- `web/app/catalog.js`: when `run()` (re)loaded at least one source (that's a "refresh": a source's `updated`
  changed, or this is the first load of the session), it asks the worker for `versions` and records them with
  `Date.now()`. Also adds `catalog.changes()` (groups built against the All Sources rows) and `catalog.onChange(f)`,
  which fires when a refresh adds records.
- `screens/changes.js`: replaces the placeholder. A virtualised list (`browse.packageList`, with the group
  headers as vlist header rows, so the sticky header works) under "New at <medium date, medium time>". It has a
  Refresh button (HUD "Reloading Data", `refreshSources()` then reload) and an empty note. Rows open
  `#/changes/package:<id>` via browse.js.
- `screens/browse.js`: `packageList` takes an optional `decorate(row, item)` hook. That is the only change there.
- `packages.css`: `.pkg-row[data-change]` puts a bold "New " / "Updated " in front of the version.

## Decisions

- The rows are grouped by `last` (when the current version first showed up), not by Cydia's default `first`.
  The brief's test needs a bumped version to move to today. Cydia only does that with "Show All Changes", or
  for installed packages under Available Upgrades.
- The stamp has seconds, as in Cydia ("New at Nov 17, 2026, 3:22:49 PM"), so two refreshes on the same day make
  two sections.
- A "refresh" here means any catalog reload that loaded a source. That is Cydia's rule: every database reload,
  not only network refreshes. Visiting Changes calls `catalog.ensure()`, so it picks up a Sources-tab refresh.
- I took the old sample badge off and set no badge. Cydia's badge counts available upgrades, which needs the
  installed list.
- Records are never pruned. Growth is one record per new version per repo, which is small next to the cached
  Packages texts.
- `getAll` and the grouping run on the UI thread. That took no visible time with 700 records here. For a
  30k-package source it is one `getAll` and a linear pass per visit, but I didn't measure it (see below).

## Checks run

- `node --test web/app`: 86 pass. New tests:
  - `core/changes.test.js`, the brief's test: the first load is dropped; a bumped version and a new package file
    under today's refresh; a repeat refresh adds 0 records and changes no groups; the records survive reopening
    the database. Also group order, `dropOldest`, mirrors across repos, duplicates, and no IndexedDB.
  - `core/catalog.test.js`: `versions`.
  - `screens/changes.test.js`: items and headers, Refresh, and the package route below Changes.
- Live in headless Chromium against `web/app.py` with real network, rootless, the 5 default sources (700
  packages). The script is `tools/changes-shots.js`, run with F5's `journal/2026-11-17-f5-packages/tools/drive.mjs`.
  - The first load shows "No changes yet" (`changes-empty.png`).
  - I then rewrote the IndexedDB records to fake history: everything seen 2 days ago, every 9th package 1 day
    ago, one package (AntiTracker) holding only an older version, and one package (Alderis) with no record.
  - After a reload, "New at Nov 17 …" holds Alderis (New) and AntiTracker (Updated 2.2), and "New at Nov 16 …"
    holds the 1-day group. The 2-day group is dropped (`changes-groups.png`).
  - The records went 700 → 701 on that reload and stayed at 701 on a repeat reload.
  - Tapping a row opens `#/changes/package:ws.hbang.alderis`. No console errors.

## Not verified

- Not on the phone (4S or a modern iPhone), and not inside the native app (`backend-native.js`). The task didn't
  call for the device. IndexedDB in WKWebView should behave the same, but I haven't checked.
- No performance trace. I didn't time `getAll` and grouping with a 30k-package source (BigBoss rootful), or the
  first ~30k-record `putMany`, on a phone.
- I didn't watch a real version bump arrive from a live repo. None changed during the session, so the bump was
  simulated by editing the IndexedDB records (above).
- No dark-theme screenshot. The rows reuse F5's package row styles, which already follow the theme.
