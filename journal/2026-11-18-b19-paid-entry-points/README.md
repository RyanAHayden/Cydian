# B19: other apt entry points skip packages a vendor sells

B11 stopped the package page from queuing a cydia::commercial package whose source has a payment_endpoint (apt
can't fetch it; Havoc answers 418). This covers the other ways one reached apt's queue.

## What changed

- `screens/extras.js`: `vendorSoldIds(rows, sources, { sells })`: the ids of catalog rows (`paid`, `key`) whose
  source has a vendor (the same cached `vendorOf` lookup as B11's `soldByVendor`). Failures count as not sold.
- `screens/changes.js` (Upgrade (N) in the jailbreak app): `load()` works out the vendor-sold upgrades once
  (`vendorSoldNow`, only where Upgrade queues and only when some upgrade is paid), keeps them in `state.data`,
  and `upgradeJobs` / `upgradeAll` take them as `skip`. The button's count matches what it queues; the rows stay
  in Available Upgrades and open the page with its Download & Install. No alert: the Confirm sheet opening for
  the rest says what was queued, as for F87's remembered apps, which are skipped the same way.
- `screens/extras.js` `addSourceAndInstall` (Search's Other Sources, F99): after the page opens, a vendor-sold
  package is not queued; it answers "paid" and the page shows the price and Purchase step (B11). A vendor that
  can't be asked falls back to queuing, as before.
- Tests: `screens/vendorsold.test.js`.

## Looked at, no change

- Wish List (browse.js renderWishlist, installed.js F125): rows only open package pages, which already use B11's
  paidActions. Nothing there queues. home.js only routes to it.
- The Home Screen icon's Upgrade All (`upgradeEverything`): it goes through `queueAll`, the sideload app queue
  (IPA jobs from `appJob`), never apt, so a paid deb can't get in. (In the jailbreak app that shortcut queues
  through the app queue rather than apt at all; that looks like a separate question and is out of B19's files.)
- essential-ui.js's queue (Cydian's own source) and queue.js's F131 linked deps: not paid vendor packages.

## Not verified

- Not run on the iPhone 7 against Havoc with a real paid upgrade pending: the task doesn't say to touch the
  phone, and no paid Havoc package is installed there to have an upgrade. Covered by unit tests with injected
  `sells`/`sold`.
