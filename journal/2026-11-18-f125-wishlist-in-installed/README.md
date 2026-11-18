# F125: Wish List lives in Installed

## What I did
- `web/app/screens/installed.js`: a Wish List row (subtitle "Packages to install later", the count as the grey
  count badge, no badge at 0) on Installed's root, opening `#installed/wishlist` (`pageKind` → `"wishlist"` in every
  mode; deeper paths are browse.js package pages as before).
  - Jailbreak app: the row sits in the grouped box with F87's Apps row, above dpkg's list. Decision: "under the
    installed lists" read literally would put it below hundreds of virtualised package rows, so it sits at the top
    with the other list rows.
  - Site / sideload: a "Packages" section under the apps (and under the site's "Jailbroken iPhone" dpkg row).
  - The page: browse.js `packageList` (no A–Z) with sources.css's Delete controls added per pooled row (`decorate`):
    Edit/Done in the nav bar shows the red minus, a tap on it or a left swipe shows Delete, Delete fades the row
    and takes the id off the list. Same gesture code as the apps list, a copy keyed on `.wish-row` (the apps one
    is hard-wired to `appView`; I didn't refactor code I didn't come for).
  - `browse.wishlist().onChange` redraws the page, the dpkg root and the apps root, so the count follows.
  - The apps page doesn't wait on `catalog.installed()` (the worker answers only once sources are in): it draws,
    then draws again with the installed ids once they come, so the count leaves installed packages out.
- `web/app/core/wishlist.js`: `wishCount(ids, installed)`; header comment says where the page lives now.
- `web/app/screens/home.js`: the Wish List row on Home is gone. The `#home/wishlist` route stays so old links
  still open the list.
- `web/app/packages.css`: on a wish row the chevron and version fade out while editing or while armed.
- Tests: `screens/installed.test.js` F125 tests (route kind, row/href/badge, count, a removal updates the count
  and fires onChange).

## Tried / failed
- Headless chromium screenshots of `#/installed` and `#/installed/wishlist` over `python3 -m http.server`: both
  stay on the loading placeholder. Unchanged main (HEAD worktree) does the same, so this is the static server
  (no Worker / `/api/fetch`), not this change.

## Not verified
- How it looks and how it behaves (the row, the badge, Edit, the swipe, Delete's fade on pooled vlist rows) in a
  real browser or on the iPhone: no setup that renders the Installed tab was at hand (see above). The user
  checks on the iPhone, as the task says.
- Whether the iOS 6 `.source-row` widths (`calc(100% - 76px)` etc.) sit right inside `.pkg-row`'s padding: not
  rendered.
