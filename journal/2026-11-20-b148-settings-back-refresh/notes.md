# B148: Settings pages refresh their details on Back

## The bug
Settings > iFizBox Account > Create Account (or Sign In), Back: the root's row still said Off. Back (and a tab
switch) shows the kept page below without rebuilding it, and the root read `accountSync().status()` only once, when
it was drawn.

## What changed
- `nav/pagestate.js`: a second hook beside B43's `onPageOpen`, for a page that comes **back** into view:
  - `liveText(node, compute)`: fills a node from `compute()` (a value or a promise) now, and again each time its page
    is shown. Answers land in order (an older read never paints over a newer one); a node taken off the page is forgotten.
  - `onPageShow(match, show)` / `pageShown(route, el)`: for screens that refresh their own page.
  - `patchDetails(cells, rows)` + `cellsOf(el)`: copy fresh row details onto the drawn cells by label, in place.
    Nothing is added or removed.
- `nav/ui.js` `grouped()`: a row can carry `live: () => detail`, and its `.cell-detail` is then a `liveText`.
- `app.js` onRoute: an existing page on top again (pop, tab switch; not a page it just built) calls
  `pageShown(mounted route, body)`. The edge swipe calls it when it begins, so the page is already right as it slides
  into view (a cancelled swipe clears that, so a later Back refreshes again).
- Rows made live: iFizBox Account (On/Off), Signing (the certificate's name, Incomplete, None; device and website),
  every list row's choice (Theme, Updates, General, Signing options: `listDetail`), Ignored Upgrades' count
  (`holdsDetail`, which also counts Ignore This Version), and General > Blocked's count (`blockedDetail`).
- Pages that refresh themselves (`settingsShown` in settings.js):
  - Installation & Signing (merged main page): F284's `mainPage.refresh()`, which already updates every slot in
    place: Install Apps With, This iPhone (Paired / Not Paired), Certificate, Signing Server, Signed Apps.
  - This iPhone / Install Apps With (`installation/<sub>`): `refreshInstallation` reads idevice.status again and
    patches Pairing, the VPN and Tailscale's Device in place. A row the new answer would add (Developer Mode once
    paired) waits for the page's next full draw, so no row appears or disappears on Back.
  - Certificate (`signing/certificate`): signing.status read again, then the certificate and profile rows patched.
- The root's Theme and Updates rows have no detail, so there is nothing to refresh on them. Their pages' list rows are live.

## Audit of other screens
- Home: the certificate tile, the Signing tile and the sources/upgrades tile already check again on `hashchange` to
  `#/home` (Back from Settings lands there), and the cert tile also follows `ifizbox:signing-status`. Fine.
- Package pages after Install/Remove: `refreshPackagePages` runs on every `catalog.onChange` (N11), so the nav-bar
  button follows what is installed. Fine.
- Sources after adding one: the add flow redraws the list itself (sources.js `draw()` after add/refresh). Fine.
- Settings' existing full redraw on `settings.onChange` (every open page, from before this task) is left as it was.
  It runs while the pages are hidden. The live rows make Back right even when no onChange fired: holds changed in
  dpkg, Ignore This Version, the account, the certificate.

## Checks
- `node --test`: `web/app/screens/settings-shown.test.js` has one test per fixed row: Account, Signing, a list
  row, Ignored Upgrades + Blocked, the real store's list row, Installation & Signing / This iPhone / Certificate
  routing, This iPhone's Pairing patch with no rows added, and only the shown page refreshing. `nav/pagestate.test.js`
  covers ordering, forgetting and patchDetails. `nav/fakedom.test-helper.js` is a small DOM for these tests.
  The whole web/app suite passed: 2146/2146.
- Chromium (headless, website build, `serve.mjs` serves web/app with an in-memory /api/account): Settings ->
  iFizBox Account -> Create Account -> Back. The root row says **On**, on the same cell element (marked before). The
  same script run against the unfixed commit (a scratch worktree) said Off. Run with
  `node journal/2026-11-18-t12-readme-shots/capture.mjs http://127.0.0.1:<port>/ <out> script.json`.
  Shots: `1-root-off.png`, `3-root-on.png`.

## Tried and failed
- My first pagestate test called `refreshLive()` with no page and hung: it waited on an earlier test's promise that
  never resolves. `pageShown` with no element now refreshes no live texts, and the tests give each node a page.

## Not verified
- On a phone (iPhone 7 .deb / sideload IPA): the task didn't ask for it, and the phone is shared with other slots.
  The Signing, Installation & Signing, This iPhone and Certificate refreshes are covered by node tests with fake
  bridges only. They were not run against a real signing.status or idevice.status.
- The edge-swipe path (refresh when the swipe begins) was not driven in Chromium; only the Back button was.
