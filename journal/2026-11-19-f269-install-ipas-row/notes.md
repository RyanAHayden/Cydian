# F269: Install IPAs row at the top of Installed

## What changed

- `screens/installed.js`
  - `installIpasRow(route, counts, { managing })`: the row as data: Install IPAs (`myipas.PAGE_TITLE`), the
    subtitle, `href` from `myIpasRow`, `badge` = IPAs not installed (none at 0 or before the count is in), the
    blue `rowIcon("ipa")` tile, `cls: "install-ipas-row"`, `hidden` while Manage is on.
  - Site and sideload app: a one-row `ul.table.plain.install-ipas-top` heads the apps list (above the first letter
    header, under the pinned search bar). It shows in the empty state too; the empty state keeps its text link.
    The footer link ("Sign and install your own apps from Install IPAs.") is gone.
  - Jailbreak app: the row goes in the dpkg root's top group, above the Apps row (grouped, like the Apps row: the
    dpkg list is virtualised, and that group is what it already measures around).
  - `loadIpaCounts()`: reads the library (site: `siteEntries()`; apps: `library.list`), asks `installedOf` and
    `sharedInstalls`, and counts with `sharedSections` so the number matches the Install IPAs page's Not Installed
    section (broken IPAs and IPAs whose bundle ID another IPA installed count as not installed, as there). Runs on
    each list load and on hashchange back to Installed's root (the root is built once). Paints the cell in place.
  - `setManaging` hides the row (`li.hidden`); the selectors that look for the apps table skip `.install-ipas-top`.
  - The Apps row got `cls: "installed-apps-row"` so B52's in-place subtitle update doesn't hit the new row's
    subtitle in the same group.
- `core/myipas.js`: `libraryCounts(entries, sections)` and `ipaCountText(counts)` ("7 IPAs · 2 not installed",
  "1 IPA", "No IPAs yet"). (`ipaCounts` was taken: the Manage toolbar's.)
- `packages.css`: the row's tile lines up with the app icons in the plain list (no Settings 3pt nudge);
  `[hidden]` hides it; the dead `.installed-footer` rules removed.
- Nav bar unchanged: Wish List | User/Recent | Manage.

## Checks

- `screens/installed.test.js`: the row's label, href, count (none at 0), hidden while managing; the counts and the
  subtitle; `loadIpaCounts` against a fake bridge (phone says which are installed, a broken IPA counts as not
  installed, an unreadable library gives no counts). B52's fixture now has the Install IPAs row above the Apps row.
- 3x render of the site build (headless Chromium, `capture.mjs` + `shots.json`, seeded 4 recorded apps and 3 IPA
  links, one installed): `installed-row.png`: same height and keyline as the app rows, grey count pill, chevron, no
  added lines or glows. `installed-managing.png`: the row is gone with Manage on.

## Found on the way

- Manage's select circles and the grey summary line don't appear on the site/sideload root (visible in
  `installed-managing.png`): `setManaging` looks for `:scope > .table` on the body, but since C10 the list is
  inside `.search-results`. Not this task: filed as B112.

## Tried and failed

- First named the counter `ipaCounts`: clashes with the existing Manage-toolbar `ipaCounts` in core/myipas.js
  (SyntaxError on import). Renamed to `libraryCounts`.
- Chained `querySelector(".a .b")` in refreshAppCount broke B52's test (its fake DOM has no descendant selectors);
  used two lookups instead.

## Not verified

- Jailbreak app (dpkg root, grouped top group) and sideload app: not rendered and not run on a phone. The task didn't
  ask for a phone test, and the render needs a fake native bridge with a dpkg status; the code path is the same
  grouped group the Apps row already uses, and `loadIpaCounts` in sideload mode is covered by the node test.
- Dark theme render of the row: not captured (it uses the stock cell, count and tile styles, which theme already).
