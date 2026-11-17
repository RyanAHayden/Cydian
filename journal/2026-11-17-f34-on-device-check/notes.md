# F34 Upgrade alerts that keep the installed list on the phone

## What was built
- **Settings > Upgrade Alerts > Check on This Device** (a second switch, shown once Daily Upgrade Check is on and
  the browser has PushManager). On: the server forgets the sources, installed list and Ignored Upgrades and
  keeps only the push subscription (`mode = "device"`). Off: back to F10's server-side check (lists re-sent).
- **Server** (`web/push.py`): `mode` column ("server"/"device"), plus `check_ms`, `check_outcome`; an existing
  push.sqlite gets them on open (`ADDED_COLS`, ALTER TABLE). `clean_subscription` drops all lists for a device
  subscriber whatever was sent; switching a row to device clears its stored upgrades/notified. `check()` skips
  device rows; `check_device()` (called from `run_daily`) sends each one a bare
  `{"type": "check", "url": "/#/changes", "id", "seq"}` **every day** (only the phone knows if anything is new).
  `/api/push/test` on a device row sends that check push (so "Check Now" is a real check). `/api/push/ack` takes
  `ms` (0..1 h) and `outcome` (ok/timeout/error/unsupported), shown by `/api/push/status` as checkMs/checkOutcome.
  The feed of a device row says the check happens on the phone. No background quiet check for device rows.
- **Worker**: `web/app/sw-device.js` is a *module* service worker: `import "./sw.js"` (reuses install, push,
  notificationclick) and sets `self.cydianDeviceCheck`. `sw.js` hands `type: "check"` pushes to it; without it
  (classic sw.js still registered) it shows "Open Cydian to check for upgrades" and acks `unsupported`, so a
  check push never goes unanswered (iOS revokes push subscriptions that don't show a notification).
- **The check** (`web/app/device-check.js`): reads sources (`cydian-sources`, core/sources.js), the uploaded dpkg
  status (`cydian-index` key `dpkg:status`, as catalog.js stores it) and `{holds, arch}` (copied by the page into
  IndexedDB `cydian-push`, since a worker can't read localStorage); fetches each Packages through
  `/api/fetch?kind=packages`; runs `core/catalog.js` `load/setInstalled/upgrades` unchanged; shows the
  notification (same words as push.py; fresh = something not in the last check's list, same rule as `decide()`),
  sets the badge, saves the baseline, acks with the time it took. It races a 20 s budget (`BUDGET_MS`): past it a
  "took too long, open Cydian" notification still goes up and `timeout` is reported.
- **Page** (`push-client.js`): `registration(mode)` registers `sw-device.js` with `{type: "module"}` in device
  mode (same scope, so it replaces sw.js and keeps the push subscription); `setMode()` moves the worker first and
  only then tells the server, so a browser that rejects module workers changes nothing and gets an alert.
  Device mode rows: Upgrades (from the last on-device check), Last Push Delivered, Last Check ("Today, 9:02 AM,
  3.1 s" / Timed Out / Failed), Check Now; no feed link.

## Decisions (no one to ask)
- **Module SW instead of making core loadable classically**: no build step is allowed, core/ is ES modules,
  `import()` is banned in service workers, and `importScripts` can't load modules. So the device mode needs
  module service workers. Rather than guess iOS support, the registration *is* the test: rejected -> stay on
  sw.js and the server-side check, with an alert saying why. sw.js stays classic for everyone else.
- **A notification every day in device mode**: iOS requires one per push and the server can't know whether
  anything is new. Nothing new -> a quiet one (`silent: true`, same tag, replaces yesterday's). The footer says so.
  Not tried: show-then-close to fake a silent push; whether iOS counts that is unknown and a wrong guess silently
  kills the subscription.
- **Time limit**: can't be measured here (no iPhone 16.4+). Instead every check reports `ms` and `outcome` to the
  server and the device shows it, so the first real use measures it; the 20 s budget is a guess below the ~30 s
  commonly reported for event handlers. Adjust `BUDGET_MS` once R7 has a number.
- No fetch written back into the page's Packages cache: the catalog re-fetches after a refresh anyway, and the
  worker writing into the page's cache could race it.
- push.mjs's `statusText/upgradesFor` were not shared with device-check.js: the worker reads the real status file,
  so it needs neither; the notification text is a ~10-line JS twin of push.py's (tested with the same cases).

## Tests
- `web/app/device-check.test.js` (6): upgrades from the device's lists over flat+dist repos (arch, holds, dpkg
  holds), failed source skipped, rules and texts, the check end to end with fakes (fresh then quiet, timeout keeps
  the baseline, no status file still notifies), and sw-device.js loaded under node with a fake `self`: the push
  listener hands a check push to the module, which shows a notification and acks.
- `web/app/push-client.test.js` (+2): device subscribe body carries no lists; Last Check text.
- `web/test_push.py` (+6): device subscription keeps no lists; daily run diffs server rows only and nudges device
  rows daily; switching to device forgets upgrades and the feed says so; an F10-era database gains the columns;
  device test push and ack ms/outcome (junk ignored); the app serves sw-device.js as JavaScript.
- Headless Chromium (CDP script in the scratchpad, not committed): page registers `sw-device.js` as a module
  worker (active), `ServiceWorker.deliverPushMessage` with `{type:"check"}` -> the worker read IndexedDB (status
  file, no sources), saved `{count: 0, outcome: "ok"}`, fetched the icon for the notification and POSTed the ack.
  No page errors.

## Hand check on an iPhone (iOS 16.4+) — noted on R7
1. With F10's steps 1-2 done, turn on Check on This Device. If iOS rejects module service workers an alert says
   so and the switch stays off: that answers the module-SW question (note the iOS version).
2. Check Now: a notification "n Upgrades" (or "No Upgrades") within the time it takes; reopen Settings: Last Check
   shows the run time. Repeat with many sources (BigBoss etc.) to find how long iOS allows: if it is cut off, the
   notification is "took too long" (budget) or none at all (iOS killed it first; Last Check stays old).
3. Server side: `status` shows checkMs/checkOutcome for the row (sqlite `check_ms`), the field measurement.
4. Next day with nothing new: one quiet notification, no sound. With a new version: a sounding one.
5. Turn the mode off: the server has the lists again (feed works), sw.js is back (Safari's Web Inspector).
6. Over days: check pushes keep arriving (iOS hasn't revoked the subscription for "silent" pushes).

## Not verified
- Anything on iOS: whether Safari/iOS supports module service workers (`register(..., {type: "module"})`), how
  long iOS lets the push handler run, whether a `silent: true` notification is quiet there, and whether daily
  quiet notifications keep the subscription alive. No iPhone 16.4+ here (the 4S is iOS 6). Steps above, on R7.
- A real check push through Apple's push service: tests use the fake service (as F10); Chromium got the push via
  CDP, not through FCM.
- The on-device check against real repos in a browser: the Chromium run had no sources (the SSRF guard refuses
  loopback, so a local fake repo can't be served through /api/fetch); repo fetching and the diff are covered by the
  node tests with fake Packages.
- Firefox's module SW support: not tried; it takes the same rejection fallback if missing.
