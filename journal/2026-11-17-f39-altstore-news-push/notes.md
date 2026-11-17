# F39: push AltStore news

## What was done
- `web/app/core/altnews.js` (new): `newsRound(urls, sent, texts, max)` and `newsPayload(item)`. One rule for the
  server and the phone, built on core/altstore.js `newsToNotify`. Decisions, made without anyone to ask:
  - **The first look at a source sets the baseline**: what it already lists counts as sent and nothing is pushed.
    Without this, opting in (or adding a source) with a dozen old `notify: true` posts would ring a dozen times.
  - **No more than 3 news per subscriber per run** (`NEWS_MAX`), newest first. Anything past that counts as sent.
  - `sent` is `{url: [identifier]}`. Each source keeps only the identifiers it still lists, and the map only keeps
    the subscriber's current sources, so it stays small.
  - One notification per item, each with its own tag (`cydian-news:<url>#<id>`). Tapping one opens the source's
    page (`#/sources/alt%3A<url>`), not the item's external `url`: sw.js's notificationclick navigates the open
    app window, and a cross-origin navigate there would fail.
- Server mode: `push-client.js` `subscribeBody` splits the AltStore records off into `altSources: [url]`. The key
  is only sent when there are some, so the existing body test passes unchanged. `push.py` validates them as http(s),
  max 200, in new columns `alt_sources` and `news_sent` (added to old databases by ADDED_COLS). They stay out of
  the `inputs` hash, so adding an AltStore source doesn't start an upgrade re-check. `check_news()` fetches each
  URL once for everyone through `fetch.Fetcher.get` (SSRF guard, 8 MB cap), runs `node push.mjs news`, and sends
  one item per subscriber per `send()` call, because send() files one status per subscriber. `news_sent` only
  moves on when all of that subscriber's pushes got a 2xx, so a failed push is retried tomorrow. `run_daily`
  calls it after the upgrade pushes, inside try/except, so a news failure never costs an upgrade push.
- Device mode: `device-check.js` `deviceNews(env, sent)` runs alongside the upgrade check, within the same budget.
  `swEnv` reads the URLs from `openAltStore` (cydian-altsources IDB) and the JSON via `/api/fetch?url=`. Notifications
  are shown after the upgrade one, and the baseline is kept in the push state under `news`. If the sources can't
  be read or a show fails, the baseline stays where it was. The server never learns about device-mode AltStore
  sources.
- Tests: `web/push.test.mjs`: a notify:true item is pushed once, a notify:false one never, the new-source
  baseline, unreachable and removed sources, the burst cap. `web/app/device-check.test.js`: the same on the device,
  plus the baseline kept on failure. New `web/app/push-client-news.test.js` (subscribeBody split) and
  `web/test_push_news.py` (check_news end to end with real node and encryption, a retry after a failed push, one
  fetch per source, device subs skipped, validation). They are new files rather than edits to push-client.test.js
  and test_push.py, which are not on this task's file list.

## Tried and failed
- Nothing failed. At first subscribeBody always sent `altSources: []`, which broke the existing deepEqual test in
  push-client.test.js. Changed it to send the key only when it is non-empty.

## Not verified
- No real push to a real iPhone or browser: no device or push subscription in this session, and the task doesn't
  ask for one. Encryption and VAPID are the code F10 already tests. The news payload is a plain
  `{title, body, url, tag, id}`, which sw.js already shows.
- Whether iOS shows several notifications from one push event (the device mode shows the upgrade notification plus
  up to 3 news). This can only be checked on a Home Screen web app on iOS 16.4+, which isn't available here.
- `swEnv`'s `altSources` against a real IndexedDB: node has none. The sw-device test covers the failure path (no
  IDB: news are skipped, the upgrade notification still shows).
