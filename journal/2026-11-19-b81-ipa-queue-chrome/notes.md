# B81: the IPA queue's Q'd badge and Queue button

## What I did
- `web/app/screens/queue.js`: `initAppQueueChrome(ctx)`, `updateAppChrome()`, `appChromeState()` and
  `setAppChromeManaging()`. These work like the apt queue's `updateChrome`, but `appQueue` drives them. The Installed
  badge reads Q'd while apps are queued, Confirm isn't open and no run is going (`appRunning`). A blue "Queue" bar
  button (`done queue-button`) goes first in the **left** slot of Installed's root, where it opens `openAppConfirm`.
  While it shows, the Wish List button is hidden (inline `display: none`, because `.bar-button.wish-button` sets
  `display: inline-flex` and that beats `[hidden]`). Manage keeps the right slot. With Manage on, Queue is hidden and
  the left button is Select… again.
- The chrome redraws when the queue changes, when Confirm opens or closes, and when a run starts or ends (in
  `runAppQueue` and `runAppQueueRun`: start, ready-fail, onClose and catch). From Confirm's tap to the run start,
  an `appChrome.starting` flag keeps the badge from flashing Q'd while the sheet slides down.
- It only draws once it has been started: `updateAppChrome` does nothing until then. That keeps the jailbreak app
  (which may use appQueue for My IPAs) on the apt-driven `updateChrome`.
- `web/app/screens/installed.js`: `init(ctx)` starts it when `recordsApps()` (the sideload app and the site), and
  `setManaging` reports Manage on or off. Both use a dynamic import of `./queue.js`, as the file already does.
  `app.js` is untouched (it isn't on the task's file list).
- `web/app/screens/queue-chrome.test.js`: covers the state table; appQueue add and clearAll toggling the badge and
  the button; the button calling open; Manage hiding the button; and the installed.js wiring.

## Decision: "Wish List stays reachable from its row"
There has been no Wish List row since F147 (it is only a nav-bar button now). So while apps are queued, Wish List
can't be reached from Installed's root. It comes back when the queue empties, and the `#installed/wishlist` route
still works. I didn't invent a new row: the brief takes the row as given, and adding one would change the apps list
layout. A person can queue a row if they want one.

## Checked
- `node --test` on the new test, queue-confirm, installed*, apprun and appqueue: all pass.
- Headless Chromium (CDP) on the site build, served locally. Before queuing: only Wish List, no badge. After
  `appQueue.add`: Q'd, then [Queue, Wish List(hidden)] on the left. Tapping Queue opens Confirm listing "Install
  Demo", with no badge while it's open. Continue Queuing: the sheet closes and Q'd and Queue come back
  (`site-queued.png`). Manage on: the left slot is only "Select…". (My first try loaded another slot's server on a
  busy port; I re-ran on a free one.)

## Not verified
- **iPhone 7, sideload build** (Reinstall an app, Continue Queuing, Q'd, Queue, Confirm). Not done. The 7 runs the
  jailbreak .deb. Installing a sideload IPA on it needs a signed build and Lite installed next to the jailbreak app,
  and memory warns against installing test IPAs carrying iFizBox's ID on the 7. The same code path ran in Chromium
  with the site build (recordsApps is true for both), but the sideload app's nav bar on a real phone wasn't seen.
- The Queue button and the badge during a real run on the black page (runAppQueueRun). Only the state logic is
  tested; no run was started.
