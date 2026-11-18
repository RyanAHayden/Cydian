# F102 Wish List

## What I did
- `web/app/core/wishlist.js` (new, pure): `createWishlist({ storage })` keeps package ids as JSON at
  `localStorage["cydian.wishlist"]` (memory copy for the session when storage throws, like core/settings.js
  safeStorage), `has/list/set/prune/onChange`; `wishLabel(on)`; `wishRows(ids, rows, installed)` for the page.
  Test: `web/app/core/wishlist.test.js` (6 tests).
- `screens/browse.js`: the package page's sheet (the Install/Modify nav button's action sheet, `packageActions`)
  gets **Add to Wish List** while the package isn't installed, **Remove from Wish List** whenever it's on the list.
  `renderWishlist(body, route)` draws the page: installed ids (`catalog.installed()`) are pruned from the stored
  list for good, the rest are looked up with `catalog.package(id)` and drawn as a plain package list (by name, no
  A–Z headers); ids no source carries now are kept in storage but not shown. Empty: a line saying how to add.
- `screens/home.js`: a **Wish List** row in Home's links group (after More Package Sources), route
  `#/home/wishlist`, and `wishlist/package:<id>` below it through browse.js, as Browse does.

## Decisions
- "The package page's More sheet": the page has no sheet named More; the only sheet is the nav button's action
  sheet (Zebra's wish list action also lives in its package action menu), so the button went there.
- APT packages only. AltStore apps' nav button installs straight away (no sheet), and their "installed" is
  another store; left out rather than half done.
- Not stored in core/settings.js (not on this task's file list); its own key, the same way holds are stored. It does
  not travel with Send Settings / the account (core/account.js) yet.

## Checks
- `node --test web/app`: all pass (753).
- Headless chromium against `python3 -m http.server` on web/app: Home's DOM has the Wish List row;
  `#/home/wishlist` pushes a page titled Wish List (the list itself stayed on Loading, since no source loads there).

## Not verified
- The list with real packages and the sheet's Add/Remove on a real package page: there was no source to load in the
  headless run (no Worker proxy locally), and the 4S wasn't in this task's scope.
- Pruning of installed packages in the jailbreak app (needs the app's dpkg status); covered only by the unit test.
- Wish List sync noted on F97 (Cydian Account).
