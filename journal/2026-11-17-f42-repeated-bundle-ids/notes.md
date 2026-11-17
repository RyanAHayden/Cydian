# F42: AltStore sources that list a bundle id more than once

## What changed

`core/altstore.js` parseAltSource no longer keeps only the first entry per bundle id:

- **Same bundle id, same name** (case-insensitive; a missing name is the bundle id, so AppTesters' nameless
  entries match): one app. Later entries add their versions (a version+IPA already there is skipped); the first
  entry's app fields (icon, description, screenshots) win. When anything merged, the versions are sorted newest
  first by date if every version has one; otherwise the source's order stays (an undated version has no place in a
  date order). AppTesters lists newest first anyway.
- **Same bundle id, other name** (RyukSign's "RyukGram (Duplicate)", "... (Duplicate, iOS 15)"): a variant, its
  own app and catalog row. Each app now has `id`, the catalog key: the bundle id for the first, then
  `<bundle id>~<name slug>` (`~2`, `~3` on a slug clash). `bundleIdentifier` stays the real id everywhere, so the
  page's Bundle ID line and installs are unchanged. appStanza uses `app.id` as `package`.
- featuredApps still matches by bundle id, which is the first app's `id`.

`core/catalog.js` needed no change: loadAlt keys rows by the stanza's `package`, history/package look rows up by it.

Decision (unattended): name is the merge key because it is the one field that separates the two shapes in the
real sources: AppTesters repeats the name with a new version, RyukSign changes the name with the same version.

## Tests

- `core/altstore.test.js`: new F42 test (merge, out-of-order dates, duplicate build, undated order, variants with
  slug clash, catalog rows per iOS, variant package lookup, merged history, featured).
- The shared fixture `core/fixtures/altstore-source.json` had "Emu again" (same id, other name, v9), which the
  old rule dropped and the new one would make a variant row, changing counts in several unrelated tests. It is now
  "Emu" repeating its own 1.5 build (merges with nothing new), so those tests keep their counts.
- `core/altstore-sources.test.js` (F28): RyukSign now 4 apps with their ids/names/minOS; AppTesters' Camera and
  madarsoft each have 2 versions.

## Follow-up filed

B7: `core/sources/ipa.js` esignToAlt's idMaker renames repeats (`com.andyworks.camera.camera`) before the parse,
so parseIpaSource("esign", AppTesters) still splits versions; and its rawApps map by bundle id gives variants the
first entry's `extra`. Not in this task's files. That path (core/sources/add.js) is not wired into the UI today.

## Not verified

- The full 10 MB AppTesters source (10,279 entries) was not parsed: only the trimmed fixture is on disk and I did
  not refetch it. The merge is one Map lookup per entry, so it should stay linear; the row count should become 789
  with full version histories.
- No browser or phone check of variant rows / Version History in the UI (core logic only; screens are untouched).
- Installs recorded from a variant use `app.bundleIdentifier` (screens/altstore.js, browse.js), so two variants
  of one bundle id share an install record. Left as is: on the phone they are the same bundle id.
