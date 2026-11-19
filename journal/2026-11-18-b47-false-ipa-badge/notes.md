# B47: false update badge on the sideload app's icon

User 2026-11-18: the Home Screen icon badge in the sideload app counted an IPA update that Changes didn't list.

## What disagreed with Changes

1. **The background check followed apps Changes can't count.** `shellWatch` sent every remembered app at the
   source *its record* names, including apps under Ignored Upgrades / blocked, apps whose source the user has
   since removed (Changes has no row: `catalog.package` finds nothing), and apps the catalog hides (F178 variant,
   or a source that no longer lists the app but still serves JSON elsewhere). `BackgroundCheck.swift` fetched those
   sources directly and set the icon badge to `found.count`.
2. **The background badge ignored Changes' count.** It was `found.count`, so it could also be *lower* than Changes
   (re-sign rows, a source failing in the background).
3. **The page didn't reset the icon on every recount.** `createUpgradeNotices.badge` sent `app.badge` only when the
   count *changed* from its own last value (so a badge the background check set survived a recount at the same
   number), and a 0 was only sent while the Changes tab was on screen (so after installing the update from
   another tab, the stale badge stayed until Changes was opened).

iFizBox's own row was not the culprit: the self record's version comes from `app.info` (CFBundleShortVersionString),
the same string Changes' `selfUpgradeRow` compares, and the source has one iFizBox app entry (tools/altsource.py).

## Fix

- `core/appupdates.js` `watchList(records, { sourceOf, ignored })` + `altSourceOf(key)`; `app-updates.js`
  `shellWatch(..., { cands, ignored })`: the shell follows only apps Changes found a row for, at that row's AltStore
  source, never ignored ones. If any catalog lookup *threw*, the watch isn't resent (keeps the last good list rather
  than dropping apps on a half answer).
- `native/sign/Updates.swift` `UpdateCheck.badge(found, pageCount:, pageKeys:)`: background badge = Changes' last
  count (stored by `app.badge` in Notifications.swift, `ifizbox.updates.pageCount`) + updates found for apps that
  count didn't include (page keys stored by `updates.watch`, `ifizbox.updates.pageKeys`). The notification's
  `content.badge` uses the same number.
- `settings.js`: in the sideload build the icon badge is set to Changes' count on every recount, 0 included, on any
  tab. The jailbreak build's daemon logic is unchanged (its 0-only-on-Changes rule stays).

## Tests

- `web/app/badge-count.test.js`: Changes' rows vs tab count vs watch vs a JS mirror of the Swift background badge,
  for iFizBox up to date, iFizBox update, ignored app, removed-source app, hidden variant; the old watch would have
  badged 4 for Changes' 1. Icon reset on every recount on any tab.
- `native/sign/tests/updates/main.swift`: `UpdateCheck.badge` cases. `native/test_updates.py`: wiring checks.
- `app-updates.test.js`: the sideload watch test now gives a catalog row (the shell follows Changes' source).

## Not verified

(Verified: `test_updates.py`'s Swift test ran and passed with the new `UpdateCheck.badge` cases, and the gate built
both the .deb and the IPA with the BackgroundCheck/Notifications changes.)

- **On a phone** (iPhone 7 and a sideload phone): not checked. The bug needs a BGAppRefreshTask to run, which iOS
  schedules on its own (hours), and this unattended run has no sideload phone session; the iPhone 7 runs the jailbreak
  build, where BackgroundCheck never runs. Worth checking by hand: ignore an app with an update, background iFizBox,
  wait for a background check (Settings shows its last run) — the icon should stay at Changes' count.
