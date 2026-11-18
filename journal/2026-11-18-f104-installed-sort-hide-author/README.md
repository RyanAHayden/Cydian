# F104: Installed sort and Hide by Author

Done (docs/sileo-zebra.md "Other things worth having", R11):

- **Installed sort** (`screens/installed.js`): the dpkg list has an iOS 6 scope bar (the search scope bar's
  `.search-scope`/`.scope-segment` styles, so no CSS change): Name (A–Z with headers, as before), Recent, Size.
  The choice is kept in `localStorage` `cydian.installedSort`. Recent and Size drop the A–Z headers and index, and
  show the date or size after the version.
  - Size: `core/catalog.js installed()` rows now have `size`, from the status stanza's Installed-Size (KiB → bytes,
    `installedBytes`).
  - Recent: a new bridge call `apt.installDates` (`native/Sources/Apt.swift installDates()`) returns
    `{ pkg: seconds }`, the mtime of `/var/lib/dpkg/info/<pkg>[:arch].list` (jailbreak path applied). The fake shell
    (`native/fake/fake-native.mjs`) does the same. Recent only shows when dates come back (not on the site, where
    the uploaded status file has no dates, and not on an older shell, where the unknown method just fails).
- **Hide by Author**: `core/settings.js hiddenAuthors` (a sorted list stored under `cydian.hiddenAuthors`, one name
  per author whatever its case), sent to the worker the way hidden sections are (`catalog.js setHiddenAuthors` →
  `core/catalog.js setHiddenAuthors`). The catalog leaves those authors' packages (by Author or Maintainer,
  lower-cased) out of lists, section counts, Search and so Changes. `author()` still lists them, so the author page
  (`screens/browse.js renderAuthor`) can show a "Show Packages by X" row in place of "Hide Packages by X".
- **Manage > Hidden** (`screens/manage.js`, `#/sources/manage/hidden`): a row on Manage with the count, and a page
  that lists hidden sections and authors, each with a switch you turn on to show it again.
- Redrawing a list in the same page (the author page's toggle, Installed's sort) now drops the old list's listeners
  and its A–Z index first (`browse.dropList`). Before this, Installed's reload added a second index.

Decisions (unattended run):
- Section counts ignore hidden authors' packages, so a section's folder number matches what it lists.
- A hidden section beats a shown author on the author page (the section stays hidden there too).
- Files changed beyond the brief's list: `catalog.js`, `core/settings.js`, `screens/browse.js`,
  `native/Sources/Apt.swift`, `native/fake/fake-native.mjs`. You can't hide by author or sort by Recent without them.
  All the changes only add code.

Tests: `web/app/screens/installed.test.js` (sorting, dates from the shell, the fake shell reading real mtimes,
Installed-Size, catalog filtering, settings, the Manage and author-row helpers).

**Not verified**
- Apt.swift's `installDates()` compiles: `tools/check.sh` builds the .deb and .ipa and passed, though there's no
  local swiftc. It has never run on a phone. The fake shell covers the same logic in node.
- Nothing was checked on a device (4S or the new iPhone 7). The task didn't ask for it, and the screen lock and
  the phones belong to other tasks. Not checked: that the mobile user can read `/var/jb/var/lib/dpkg/info` (the
  app already reads `dpkg/status` beside it), and how fast it stats ~1,000 `.list` files.
- The UI wasn't checked in a browser: the scope bar above the plain list, the author-page row, the Hidden page's
  switches and the 3x render.
