# C29: one route table for Home

## What changed
- `web/app/screens/home.js`: `ROUTES`, a list of `{ match, nav, render }` (match = first path segment, `null` =
  the tab's root and anything unknown). `nav()` and `render()` are now one-line lookups. Browse's pages
  (`browsePage().page`) got their own `BROWSE_ROUTES` the same way; `browseRoute()` binds the page's value to the
  entry. `renderBrowseRoute()` and both switches are gone; Home's own root bar moved to `homeNav(ctx)`.
  Behaviour is the same route by route (guides/why render still return undefined, as before).
- `screens/why.test.js`: a source-text check pinned the old `case "why":` lines; it now matches the route entry.
  No router test changed.
- New `screens/home-routes.test.js`: nav() titles for each plain route, and root/unknown -> Home's bar.

## Other tabs
Search, Changes and Sources only split root vs browse.js: a table would not read better. Installed has the same
paired shape (pageKind over browse/myipas/app/wishlist/apps/dpkg), but installed.js is outside this task's files:
filed as C40 (low). Settings' nav is already title tables plus special cases; left alone.

## Checks
- `node --test` in web/app: 2508 pass (before the new test file), new file 2 pass.
- `tools/check.sh` via `run done`.

## Not verified
- No browser or phone run of Home's pages: the change is a pure refactor of dispatch, covered by the node tests
  (home-browse, browse-filter, homereload, why, homelock) and the new route test.
