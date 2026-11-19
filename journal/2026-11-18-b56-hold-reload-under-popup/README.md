# B56: never reload the website while a popup is up

## What I did

- `web/app/nav/popups.js` (new): `popupOpen(doc)` is true while any shown `[aria-modal="true"]`, `[role="dialog"]`
  or `[role="alertdialog"]` is in the page. Every popup already marks itself that way (alert.js, actionsheet.js,
  sheet.js, sharesheet.js, progress.js, queue/reviews sheets, altstore's screenshot zoom) and leaves the page once it
  has closed, so no popup module needed changing. `whenNoPopup(doc)` resolves once none is up: a MutationObserver
  on body (childList + role/aria-modal/hidden attributes) plus a 1 s poll as a fallback.
- `screens/home.js refreshIfNewBuild`:
  - when a new build is found while a popup is up, it waits (`hold`) until the last one closes, then refreshes;
  - the reload itself (after refreshWebFiles has downloaded every file) checks again, so a popup that opened during
    the download also holds the page load;
  - the new commit is written to `ifizbox.webBuild` only when the reload actually runs (before, it was written
    first). That way a page closed with the popup still up reloads on its next open, instead of believing it's
    current;
  - only one check runs at a time: a check made while another is running or held (app.js calls it on open and on
    every return to the foreground) gets the same promise, so it never reloads twice.
  - The Reload button (`reloadHome` -> `refreshWebFiles`) is unchanged.
- app.js needed no change: its open/foreground calls go through `refreshIfNewBuild`.
- Tests: `nav/popups.test.js` (detection, hidden dialogs, waiting for the last of two, observer disconnected) and a
  B56 test in `screens/homereload.test.js` (a new build found with an alert up doesn't reload or note the commit
  until the alert closes; a second check joins it; one reload; no loop after).

## Tried and failed

- First version held only the part after `info()`: two checks started at once both got past the guard and
  reloaded twice (the new test caught it). Now the whole check is the one shared promise.

## Not verified

- Not tried in a real browser or on a phone (ifizbox.com/?install with a new build landing). The run has no
  browser here and no new build to publish. The logic is covered by the node tests with fake DOM/observer.
