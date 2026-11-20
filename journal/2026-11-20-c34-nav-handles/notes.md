# C34: last nav-item lookups by selector → page handles

## What changed
- `web/app/nav/navbar.js`: `navItemOf(body)` is now `handleOf(body)?.item` (nav/go.js). The old version took the
  page's index in its tab and queried `.nav-stack[data-tab=…] > .nav-item`.
- `web/app/screens/installed.js`: `render` takes the 4th `page` argument app.js already passes in. On the root route
  it hands that handle to `screens/queue.js` (`setInstalledRoot`). It does this only where a Queue button exists
  (`recordsApps()`, or a backend with `queue`), so the site doesn't load queue.js for nothing.
- `web/app/screens/queue.js`: `setInstalledRoot(page)` stores the handle and redraws the chrome. apt's Queue button
  (`updateChrome`) uses `installedRoot.item`'s `.nav-right`. The IPA queue's button (`installedRootLeft`) uses
  `installedRoot.left()`. A bonus: app.js `drawPage` clears the item's children right before `render`, so the button
  now comes back right after a redraw, not only on the next hashchange/rAF. The old hashchange/rAF redraws are still
  there.
- Tests: `altstore-marktoggle.test.js` registers the item with `pageHandle(item, body)`, and its fake
  `document.querySelectorAll` now throws. New `queue-rootpage.test.js` covers `setInstalledRoot` → left slot, plus a
  source check that installed.js hands the page and that neither file queries `.nav-stack[`.

## Left alone
- `web/app/nav/sharesheet.js` still has its own copy of the index-based `navItemOf`. It's not in this task's files,
  so I didn't change it. Follow-up filed (see below).

## Tried and failed
- I typed a stray shell command that waited on stdin and ended up in the background. It had no effect.

## Not verified
- I didn't test on a phone or in a browser (no UI run): the Queue button on Installed's root in the jailbreak app
  (iPhone 7) or in the sideload app. The node tests use fake DOMs. The behaviour should be the same because the handle
  wraps the same `.nav-item` the old `:first-child` selector found (the root is the first page of its tab).
