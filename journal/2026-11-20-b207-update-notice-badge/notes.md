# B207: an update notice with no icon badge (Sideload/Lite, iPhone 15 Pro)

## Why it happened

The user's notice said "… is available": that wording is only in the push server's alert
(`worker/src/push.js` alertFor, iFizBox's own update), not in the background check's ("1 Update", "Delta 1.6").
So it came over APNs, and **the push payload had no `aps.badge` at all**: an update push never touched the icon,
whatever iOS allowed. That is the main cause.

A second hole, in the background check (BackgroundCheck.swift / UpdateCheck.badge): the page's `known` keys
(updates.watch) also hold versions the user ignored (F281, Ignore This Version), and the badge math treats every
id in `known` as a row Changes already counted. An app at an ignored version whose next version came out got a
notice ("App 1.7") with a badge of Changes' last count, 0 on a phone that showed nothing.

Ruled out: BackgroundCheck's badge only when `badgeSetting == .enabled` is right (iOS ignores it otherwise; the
notice's own `content.badge` was already set to the same count). B124's own-update exclusion only acts once
iFizBox hands iOS its own install, which a notice alone doesn't do.

## What changed

- `worker/src/push.js`: `badgeFor(device, offersBy, pushed)`: Changes' counted rows (`counted`, else `known`) plus
  every followed app with an update not on screen; never under the updates pushed. runPushCheck puts it in update
  alerts as `aps.badge`; expiry warnings leave the badge alone. Registration takes an optional `counted` list,
  stored in a new `counted` column (NULL = same as `known`), added with a guarded `ALTER TABLE` to tables made before.
- Page: `app-updates.js` sends `counted` (Changes' counted rows' keys) beside `known` when ignored versions make them
  differ; `core/push.js` passes it to the server and keeps it in the remembered watch.
- Native: `UpdateCheck.pageKeys(known:counted:)` (BackgroundCheck stores `counted` as the page keys) and
  `UpdateCheck.noticeBadge` (a posted notice's badge is never under the count of fresh updates it tells of).
- Settings > Updates (sideload): with Icon Badge off in iOS (and iOS already asked), the Update Alerts group gets
  "Turn On in Settings" and the footer "Icon Badge is off in iOS, so update alerts can't show a count on the icon.";
  the iFizBox Updates switch moves to its own group with its footer (one hint per group).
- Tests: native/sign/tests/updates/main.swift (B207 case), native/test_updates.py, worker/test-push.mjs (badge
  math, payload, `counted` stored, older table migrated), app-updates/push/settings JS tests.

Notifications.swift needed no change: app.notifyStatus already reports `status` and `badges`.

## Not verified

- On the iPhone 15 Pro: no push or background run was triggered there (it is the user's phone; a real APNs push
  needs the deployed Worker, and the runner publishes after merge). The payload is checked against the fake APNs
  in worker/test-push.mjs only.
- The D1 `ALTER TABLE` on the live database: tested on Node's SQLite with an old-shaped table, not on Cloudflare D1.
- The Settings footer was checked by unit tests only, not rendered on a phone.
