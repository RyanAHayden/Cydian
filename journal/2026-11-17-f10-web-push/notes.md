# F10 Upgrade alerts for the web: PWA, Web Push, private feed

## What was built
- **PWA**: `web/app/manifest.json` (standalone, start `/`, icons copied from `native/icon/` into `web/app/icons/`),
  `<link rel="manifest">` and `apple-touch-icon` in `index.html`.
- **Service worker** `web/app/sw.js`: push and notificationclick only, **no fetch handler** (nothing cached, the
  app loads as before). On a push it shows the notification (iOS requires one per push), sets the Home Screen badge
  to `count` (`navigator.setAppBadge`), and POSTs `/api/push/ack` so Settings can show "Last Push Delivered".
  Tapping opens/focuses the app on `#/changes`.
- **Server** `web/push.py` (Flask blueprint, registered in `app.py`; stdlib sqlite in `$CYDIAN_DATA/push.sqlite`):
  `GET /api/push/key`, `POST /api/push/{subscribe,status,unsubscribe,ack,test}`, `GET /feed/<token>` (Atom).
  Two tokens per subscriber: `id` (management, only ever in POST bodies so it stays out of access logs) and `feed`
  (the read-only feed URL). Unsubscribe deletes the row. Push endpoints are allowlisted to the browsers' push
  services (Apple, FCM, Mozilla, WNS), https:443 only: the server POSTs to them, so this is the SSRF guard for pushes.
  Repo fetches in the check go through `fetch.fetch_packages` (the F3 guard), each index once for all subscribers.
- **Node half** `web/push.mjs` (CLI: `keys`, `dirs`, `diff`, `encrypt`, JSON on stdin/stdout): the diff runs
  `core/catalog.js` `createCatalog().load/setInstalled/upgrades` unchanged, so the server's answer is exactly the
  app's Changes tab (newest version over all sources, arch filter, hidden-from-Cydia packages skipped, Ignored
  Upgrades and dpkg holds ignored). Subscribers with the same sources+arch share one loaded catalog. Encryption is
  RFC 8291 aes128gcm and VAPID (RFC 8292) ES256 via WebCrypto: Python's stdlib has no P-256/AES-GCM, and the
  rules say no new dependency without asking, so node (already in the image) does it. The test matches RFC 8291's
  Appendix A vector byte for byte, and a separately written decrypt round-trips a fresh message.
- **The rule** (`push.decide`): push when today's available upgrades contain a (package, version) the last
  successful push, or the last quiet day, didn't cover. So the same "3 Upgrades" isn't repeated daily; a new
  package or a newer version is. A failed push (5xx, unreachable) is retried next day; 404/410 forgets the endpoint
  (the feed keeps working, the app re-subscribes on next open).
- **Daily job**: `python push.py daemon` (a second compose service, `cydian-push`, same image and data volume)
  runs at `CYDIAN_PUSH_HOUR` UTC; `python push.py run` once by hand. Subscribers not seen for
  `CYDIAN_PUSH_EXPIRE_DAYS` (180) are deleted. A new or changed subscription is checked at once in a background
  thread without pushing, so Settings and the feed show a count straight away.
- **Client** `web/app/push-client.js`: Settings gets an "Upgrade Alerts" group (site mode only) with the
  "Daily Upgrade Check" switch; when on: Notifications (On/Off/Blocked/"Add to Home Screen"), Upgrades count, Last
  Push Delivered, Send Test Notification, Copy Feed Link. Only `{id, version, held}` per installed package, the
  sources' uri/dist/components and Ignored Upgrades leave the device. `app.js` calls `startPush` 3 s after launch:
  registers the worker and, when opted in, re-subscribes and re-sends the lists every open (iOS drops
  subscriptions), then sets the badge to the local upgrade count. `Notification.requestPermission()` is called
  before any await in the tap handler, and the VAPID key is prefetched when Settings draws, so iOS still counts
  the subscribe as part of the tap.
- Deploy: `Dockerfile` copies push.py/push.mjs, makes `/data` (owner 568) with `CYDIAN_DATA=/data`;
  `compose.yaml` adds the `cydian-data` volume and the `cydian-push` service (its healthcheck off: the image's
  check is the web server's). README lists the new variables. `.gitignore`: `/web/data/` (local dev store).

## Decisions (no one to ask)
- Server-side diff first (the brief's main ask); the "bare check-now push answered on-device" variant from R4 is
  filed as **F34**: it needs core in a service worker on iOS and a measured push-handler time limit.
- The opt-in needs the installed list (site: the uploaded status file); without one the switch says to upload it.
- The first daily run after opting in pushes whatever upgrades exist (the quiet background check doesn't move the
  baseline), which doubles as proof push works.
- VAPID `sub` defaults to the subscriber's own origin (`https://<host>`), overridable with `CYDIAN_VAPID_SUBJECT`;
  no email of anyone is baked in.
- No `pushsubscriptionchange` handler: Safari doesn't fire it, and re-subscribing needs the lists, which only the
  page has; the every-open re-subscribe covers it.

## Tests
- `web/test_push.py` (18): rules (decide, text, payload size, since), endpoint allowlist, input validation, the daily
  flow end to end with real node diff + real encryption against a fake push service (day 1 push, day 2 quiet, day 3
  new version, 500 retried, 410 forgets endpoint, quiet check, one fetch per index), endpoints via Flask's test
  client, the feed parses as Atom and never contains the management id, and it runs `node --test web/push.test.mjs`.
- `web/push.test.mjs` (8): RFC 8291 vector, decrypt round-trip, VAPID JWT verifies, diff across flat+dist repos,
  holds, shared catalogs, status-text injection.
- `web/app/push-client.test.js` (4): what the subscribe body sends, key decoding, Notifications row states.
- Headless Chromium (CDP script in the scratchpad, not committed): Settings with the switch off and on (with a
  subscription made by curl, whose background check filled "Upgrades 0"); no console errors or exceptions.

## Hand check on an iPhone (iOS 16.4+) — filed as R7
1. Deploy; open the site in Safari, Share > Add to Home Screen; open Cydian from the Home Screen icon.
2. Installed tab: upload the dpkg status file. Settings > Upgrade Alerts: turn on Daily Upgrade Check. iOS should
   ask to allow notifications; allow. Notifications should read On, Upgrades a number within a few seconds.
3. Send Test Notification: a banner within seconds; reopen Settings: Last Push Delivered shows today.
4. Badge: after a real upgrade push the icon shows the count (Settings > Notifications > Cydian > Badges on).
5. Tap the notification: Cydian opens on Changes.
6. Daily push: `docker compose -p cydian exec cydian-push python push.py run` with a known upgrade; a "n Upgrades"
   banner arrives; run again: nothing (same list).
7. Copy Feed Link, paste into a feed reader: one entry per upgrade.
8. From the standalone app, tap an `itms-services://` install link (AltStore/IPA source): note whether iOS opens it.
9. How long iOS lets the push handler run (matters for F34): time the ack's arrival against the push.
10. Later (days): check that alerts keep coming after iOS drops the subscription (Notifications row stays On after
    an open; server log shows the new endpoint).

## Not verified
- Everything on a real iPhone (steps above): no iPhone 16.4+ here, and the 4S runs iOS 6 (no Web Push). Filed R7.
- A real push service accepting our requests (Apple/FCM): tests use a fake service; the crypto matches the RFC
  vector and the VAPID JWT verifies, but no request went to web.push.apple.com from here (needs a real browser
  subscription on a deployed origin).
- The Docker image: not built here (would pull the base image). Debian's nodejs in python:3.13-slim is node 20;
  push.mjs only uses WebCrypto, Buffer base64url and node:url, all in node 20, but it was run under node 26 only.
- `cydian-push` daemon: the next-run maths is tested, the sleep loop was not left running for a day.
- Chromium's real permission prompt and PushManager.subscribe: headless has no prompt; only the drawing was checked.
