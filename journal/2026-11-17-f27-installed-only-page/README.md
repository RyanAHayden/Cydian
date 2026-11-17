# F27: package page for installed packages no source carries

## What I did
- `core/installed.js`: split `parseStatus` into `installedStanzas(text)` (the on-disk stanzas, first per package)
  and the row mapping; `parseStatus(text, stanzas)` takes the stanzas so the catalog parses the file once.
- `core/catalog.js`: `setInstalled` keeps id -> status stanza. `package(id, key)` falls back to it when no source
  carries the id and returns `{ stanza, key: null, row, others: [], installedOnly: true }`. `has()` counts
  installed packages too, so a Depends line naming an installed-only package links to its (now working) page.
- `screens/browse.js`: the page already draws from `pkg.stanza` (name, version, Author/Maintainer, description,
  Depiction/Homepage, Details incl. Installed Size, Depends, Conflicts, Installed Package group). For
  `installedOnly` it leaves out the Source group (there is none); the footer then shows id and section only.
  No download row (no `debUrl`), no icon image (status `Icon:` is a file:// path on the phone).
- Test in `core/installed.test.js` on the dpkg-status fixture (f.lux, on no source).

Decision: the fallback applies for any key, not only "*": a page reached under a source that doesn't carry the
package is still more useful showing the installed stanza than "Package not found". In practice the Installed
tab opens it under "*".

## Tried and failed
nothing

## Not verified
- The page in a browser / on the device: no browser run in this session (the page code change is one guarded
  line; the data path is covered by the node test). Worth a look on the site with the fixture status file
  uploaded: Installed -> f.lux.
