# C23: page handle and one go()/back()

## What changed

- New `web/app/nav/go.js`: `go(to)` (a route or a hash, `#` optional) and `back()`; app.js hands in the router's
  `go` and its own `goBack` (`setNavigator`). Without a navigator (node tests) `go` writes `location.hash` and `back`
  calls `history.back()`, so tests that stub `globalThis.location` behave as before.
- Same module: `pageHandle(item, body)` → `{ item, title(), setTitle(text), rightButton(match?), left() }`, and
  `handleOf(body)` to find it again from a page body. app.js `makePage` builds one per page (`entry.handle`) and
  passes it to `screen.render(body, route, ctx, page)`.
  - `rightButton()` with no match skips `.nav-moved` (B176's pushed Refresh) and `.share-button` (F76's Share),
    which covers what Changes' and Browse's own selectors excluded.
  - `handleOf` exists because the helpers that set titles/labels (browse.js setTitle/setRightLabel, myipas.js setTitle,
    altstore's relabel) sit several async calls below render and only hold the body; threading the 4th argument
    through all of them would have touched far more code. Changes and My IPAs take the 4th argument (falling back to
    `handleOf(body)` for redrawCopy, which calls render itself).
  - Named `handleOf`, not `pageOf`: browse.js and myipas.js already export a `pageOf(route)`.
- Hash writes replaced (all in screens/, no `location.hash =` left): extras ×2, sources, account, installroute,
  safety, guides, signing (goHash removed), myipas, changes, home, browse, installed.
- Own nav-item lookups replaced (8): changes drawUpgradeButton, browse setRightLabel / setTitle / toggleVisibility,
  myipas setTitle / Select… left slot, altstore relabel (was "the active stack's top item", now its own page's),
  installroute's edge-swipe Leave (clicked `.nav-item.is-top .bar-button.back`; now `back()`; `guardSwipe(e, back)`
  takes the function, test updated).
- Private back helpers in myipas.js (`let back = ctx.back`) and installed.js renderAppPage use nav/go.js `back`.
- router.js and nav/stack.js unchanged.
- Tests: `nav/go.test.js` (fallback, navigator, handle, and a source check that screens/ has no hash writes or
  index lookups). `nav/navbuttons.test.js` grepped changes.js for the old selector; now checks `rightButton()` and
  go.js's moved-class skip.

## Checks

- `node --test web/app`: all pass after the navbuttons.test.js fix (it was the only failure on the first run).
- `node tools/smoke/smoke.mjs` and `--site`: passed (push, Back, swipe back, sheet).

## Left for later

- C34 (filed, low): nav/navbar.js addNavIcon's index lookup and queue.js's Installed-root `.nav-item:first-child`
  queries. Outside this task's file list (navbar.js) or another page's item (queue.js), so not done here.

## Not verified

- The handle paths in a real browser: the smoke test doesn't open Changes (Upgrade count button), a package page
  (title after a deep link, Install/Modify label), Sections' Edit (Section Visibility title), My IPAs' Manage
  (Select… in the left slot) or an AltStore app page (Install/Upgrade relabel). Covered only by reading the code and
  the handle's unit test; no phone test (task didn't call for one, and the iPhone 7 isn't for refactors).
- The Installation page's edge-swipe Leave on a phone (needs a pairing in progress on the jailbreak app).
