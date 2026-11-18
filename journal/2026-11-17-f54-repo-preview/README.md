# F54 A tweak repo's Recommended preview lists its packages

## What I did
- `core/sourcelist.js` `packagePreview(stanzas, arch)`: from parsed Packages stanzas, the packages that install on
  this arch, visible ones only (core/catalog.js isVisible: no cydia::obsolete, enduser/hacker/developer roles),
  one row per package (newest version wins), grouped under Cydia's section names (catalog.js sectionName), sections
  and names A to Z. Rows are browse.js's row shape: `{ id, name, short, icon, paid }`.
- `screens/manage.js` renderRepoPreview: the preview page of a tweak repo (`#/sources/manage/recommended/<key>`)
  fetches each Packages file of its layout (core/apt.js repoLayout) through `backend.packages` (the same path
  Refresh uses: .xz/.bz2/.gz decompressed by the server or the native shell), parses it in the worker
  (`getParser().packages`, core/parser.js, inline fallback where Workers don't exist), sums it up with
  packagePreview, and draws it as a virtualised list (browse.js `packageList`, letters off, a section header
  "Name (count)" before each section's rows). A footer says "N packages in M sections". Rows don't link: the repo
  isn't in the catalog, so there's no package page; Add first. Read once per visit per arch (a Map of promises);
  a failure is dropped from the map so the next visit retries.
- `sources.css`: one line after `.rec-apps` hiding the package-row chevron in `.rec-packages` (rows don't open).
  sources.css wasn't on the task's file list; one added line next to F52's own preview rule.
- Test: `core/sourcelist.test.js` packagePreview (arch filter incl. `all`, role/obsolete hiding, newest version,
  section naming with `_` and no Section, sort, icon resolved against the root, paid tag, empty input).

## Checked
- `node --test web/app/core/sourcelist.test.js`: 18 pass.
- Headless Chromium over CDP against the Flask dev server (main checkout's .venv, port 8754), device set to
  Jailbroken: palera1n (6 packages, 4 sections, all rows drawn), Havoc (376 in 4 sections), Chariz rootful
  (182 in 7 sections, 18 rows in the DOM: virtualised). Icons load, no chevrons, no row has an href.

## Tried that failed
- First run of the server with system python3: no flask; used the main checkout's `.venv/bin/python` (read only).

## Not verified
- The native app's backend (`backend-native.js` packages via the shell): only the site backend was exercised.
- On the phone: scrolling feel of the preview list and the sticky section header under the grouped head.
- A dist repo preview (several components): every Recommended tweak repo is flat (`./`); the loop over
  `layout.packages` covers it but no dist repo was tried.
- The Recommended list rows still show no package count for tweak repos not added (unchanged from F52: the list
  doesn't fetch Packages; only the preview does).
