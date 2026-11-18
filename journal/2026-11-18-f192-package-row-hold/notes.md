# F192: hold a package row for the iOS 6 callout

## What I did

- `web/app/screens/browse.js`: every package list (`packageList`, so Search, sections, author, Installed, Changes,
  Wish List, My IPAs) gets `attachRowMenu`: `nav/menu.js` `longPress` on `.pkg-row`, then `showMenu` (the black
  callout, one row) anchored on the row at the finger's x. `longPress` already swallows the click that ends the hold,
  so the row doesn't open.
- Items come from a pure `rowMenuItems(item, { queue, installed, newest, queued, listKey })`:
  - queue action, only where the backend has a queue (the jailbreak app): `Cancel` when it's already queued
    (`installQueue.clear`), else `Upgrade` (installed and a source has a newer version), `Remove` (installed),
    `Install` (not installed and a source can download it). It calls the backend's `queue(job)` as the package page's
    sheet does (`queueOf({ installed, name })`), which marks the queue and opens Confirm; the package page is not
    opened. Installed/newest come from `catalog.history(id)` fetched at the hold (the row has no installed version).
  - AltStore apps (`kind: "ipa"`) and paid packages their vendor sells that aren't installed get no queue item: both
    install through their page (F80 / B11's Purchase step). Installed paid packages still get Remove.
  - `Share`: always. Opens `nav/sharesheet.js` with `packageShareItems(item, source)`: Copy Link (the site's
    `#/search/package:<id>`, a route every visitor can open, not the list's own route which may name a source they
    don't have) and, on the website with the phone set to Jailbroken and an APT source, the managers that open the
    package (`core/handoff.js packageLinks`, as the package page's Open In group). The app lists no other managers.
  - `Source`: opens `#/sources/<key>`; left out when the list is that source (Sources > source > section) or the row
    has no source (installed only).
- Not offered while the list is editing, on a row showing Delete (Wish List), or on rows with no page (an unadded
  repo's preview in manage.js).
- `web/app/ios6.css`: `.pkg-row.is-held` keeps the blue selection (white text and chevron) under the callout, as
  `.cell.is-held` does for source rows; the icon keeps its colours.
- `web/app/screens/browse.test.js`: the item list per state and the share items.
- `nav/menu.js` needed no change.

## Tried and failed

- `packageLinks` from `core/handoff.js` clashed with browse.js's existing `packageLinks` import from
  `core/previews.js` (a different function); imported as `managerLinks`.
- First iPhone 7 pass: a queued row held blue kept queue.css's "Queued for" colour (dark blue / red), because
  `.pkg-row[data-queued] .pkg-desc` ties `.pkg-row.is-held .pkg-text *` on specificity and loads later. Raised the
  held rule to `.pkg-row.is-held > .cell-inner .pkg-text *`; checked white on the phone after.

## Checked

- `node --test web/app/screens/browse.test.js`: the item list per state (Install / Upgrade / Remove / Cancel, no queue,
  paid, AltStore app, Source left out in its own list or with no source) and the share items.
- iPhone 7 (built this branch's .deb, 0.9.2-1130, installed with apt; `tools/ui-7.sh` under the F192 lock; a hold is
  `swipe X Y X Y 0.9`), screenshots in `ref/7/screens/f192-*.png`:
  - Search "appsync": hold AppSync Unified -> callout `Install | Share | Source` above the row, row blue, page not
    opened (`f192-hold`).
  - Share -> the iOS 6 share sheet with Copy Link; Copy Link -> "Copied" HUD (`f192-share`, `f192-copied`).
  - Source -> Maxine's Repo's sections (slid in on the Search stack, as the app does for other tabs' links).
  - Maxine's Repo > Tweaks: hold -> `Install | Share` (no Source in its own source), the callout below the row near
    the top (`f192-inrepo`). Install -> Confirm with Install AppSync Unified; Continue Queuing; hold -> `Cancel |
    Share`; Cancel -> queue cleared, Q'd badge gone (`f192-queued`, `f192-cancelled`).
  - Installed: hold curl -> `Remove | Share | Source`; Remove -> Confirm with Remove curl; Continue Queuing; hold ->
    `Cancel`, "Queued for Remove" white on the held row; Cancel -> queue empty (`f192-h4`, `f192-final`). No apt run.
  - A plain tap still opens a row (ca-certificates, by accident while the reload bar went away).

## Not verified

- Upgrade on the phone: no installed package has a newer version (apt's "upgradable" ones are the same version),
  so only the unit test covers Upgrade.
- What Copy Link put on the pasteboard: the phone has no pbpaste; the HUD and the unit test (the URL) only.
- The website's Share with the package managers (site + Jailbroken + APT): unit test only, no browser run.
- The phone was left on this branch's build (0.9.2-1130, with the CSS fix copied into the bundle by hand); the next
  deb installed replaces it.
