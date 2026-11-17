# F48: Import adds dist repos

## What I did
- `core/sources.js`: `verifySource` also takes `{ uri, dist, components }`. A flat dist ("./") goes through the
  usual flat check; any other goes to the new `verifyDistSource`: URI normalized, suite and components checked
  against a path charset with no `.`/`..` parts (they end up in URLs and on the helper's command line), Release
  or InRelease must be under `dists/<suite>/` (else `not_repository`), empty components fall back to the
  Release's `Components:`, then `refreshSource` counts each component's Packages, and an error there (a wrong
  component) is a `verification` error, the same as `core/sources/add.js` does for dist repos it finds. A Release
  whose Architectures leave ours out (Telesphoreo) is added with count 0, as Refresh shows it.
- `sourceCalls.addSource` (site) and `nativeSourceCalls.addSource` (app) needed no code change: both call
  `verifySource`, and the native `writeSource` already passed the suite and components to
  `cydian-helper addsource` (F33). I added comments there and tests.
- `withAltSources.addSource` (core/altstore.js, not on my file list) needed no change: `looksLikeAltUrl` of an
  object is false, and its AltStore fallback on `not_repository` fails on an object and rethrows APT's error
  (tested in backend-native.test.js).
- `core/sourcelist.js`: a dist entry's `input` is now `{ uri, dist, components }`, so `reviewImport` marks it
  "new" instead of "unsupported". The "Can't Add" section in `screens/manage.js` stays for entries without an
  input (none come from the parsers today); its footer no longer says dist repos can't be added.

## Tests
- sources.test.js: dist add (count, origin, key), components from the Release, foreign-arch Release (count 0),
  rejections (no Release, HTML Release, wrong component, no components, bad suite/component, ftp), flat dist.
- sourcelist.test.js: dist entries are "new" with an object input (updated three assertions that expected
  `null`/"unsupported").
- backend-native.test.js: dist addSource through the fake native writes `addsource <uri> stable main` and a
  cydian.sources stanza with Suites/Components; a missing Release is `not_repository`.

## Not verified
- The Import review and Add in a browser or on the phone: no UI run in this unattended session; the screen code
  change is a footer string, and the add path (`getBackend().addSource(e.input)`) is unchanged.
- A real dist repo over the site's proxy or apt on a device: covered by fakes only.
