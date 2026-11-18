# B52: Installed root's Apps count after a Delete

## Cause
In the jailbreak app, the Installed root (dpkg list with the F87 Apps cell on top) stays in the page stack
under the Apps page. `load()` reads `jailbreakAppCount()` only once. A Delete or Remove from List on the Apps page
calls `removeInstall`, which fires `onAppsChange`, but only the Apps page was listening. So going back showed the old
"2 apps installed from an app page".

## Fix (web/app/screens/installed.js)
- New `refreshAppCount()`, called from `init()`'s `onAppsChange` listener next to `loadApps()`. It counts the
  records again and:
  - while the cell stays (old and new counts both > 0), changes the cell's `.cell-subtitle` in place. No redraw, so
    the dpkg list keeps its scroll position and its vlist offset.
  - when the cell appears or goes away (0 ↔ n), calls `draw()` again, because vlist.js caches where the list starts.
  - does nothing outside the jailbreak app (`recordsApps`), before `load()` has drawn the root (`rows === undefined`),
    or when a `load()` started while it was counting (`seq` changed), so load's own count is used.
- `appsRowSubtitle(n)` moved out of `appsRow` so the refresh and the cell use the same words.
- This also covers every other `removeInstall`/record change while the root is in the stack (e.g. an install from an
  app page), because it hooks the store's change event and not just runDelete.

## Tests
installed.test.js has two B52 tests: in-place subtitle update, redraws when the count goes to 0 and back, and the
guards (sideload mode, root not drawn yet, a load() running at the same time).

First try: I wrapped the async test body in `withDom`. That fails because withDom is synchronous and takes `document`
away before the awaits finish. Now the DOM is built inside withDom and the async calls run after it.

## Not verified
- On the iPhone 7: I did not install a test IPA, delete it, and then go back. That needs a deb build and deploy, a
  fakesigned IPA, and the ui-7 lock. It is too much for a low-priority fix that the unit tests cover. The live path
  (removeInstall → onAppsChange → refreshAppCount) is the same one that already refreshes the Apps page, which R21
  confirmed on the device. If it still looks stale there, check that `state.body` is the root that is still in the stack.
