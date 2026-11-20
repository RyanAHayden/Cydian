# F285: Sideload Settings > Updates, alerts reworked

## What changed

- **Push on by default** (`core/push.js autoEnablePush`, called from `app.js` 3 s after launch, sideload only). It
  turns Push on when `GET /api/push` says `enabled: true`, `offReason` is null, iOS notifications are already
  `authorized`/`provisional` (so no permission prompt at launch) and Push is neither on already nor turned off by the
  user. The Push switch remembers an explicit Off (`ifizbox.push.userOff`); turning it on by hand clears that. A failed
  automatic try puts the stored state back as it was (off, no error) and tries again next launch. While ifizbox.com
  answers `no_key` nothing happens; once the key is there, the next launch turns it on with no app update.
- **New switch `<NAME> Updates`** (core/settings.js `selfUpdateAlerts`, sideload, default on, in section "alerts",
  which no SECTIONS group draws). Footer: "Off, only your apps' updates alert you; <NAME>'s own update still shows in
  Changes." Off: `app-updates.js withoutSelf` drops iFizBox's own entry from the watch sent to `updates.watch` and to
  push registration (syncPush). Flipping it sends the last list again at once (`selfAlertsChanged`). No native or
  Worker change; the Signature Expiring push (`expires`) stays.
- **Layout** (screens/settings.js `notifyRows` returns two groups; `notifySection` draws both, using
  `push-settings.js pushActions` for the Push switch and Test Push). The sideload build puts them above Ignored
  Upgrades; the jailbreak build and the site no longer get the empty boxes, so nothing they show changes.

  - Update Alerts: Notifications (iOS), Icon Badge (iOS), <NAME> Updates. Footer: the switch's.
  - Checking for Updates: Push, Check in the Background, Background App Refresh (iOS), Last Push, Last Background
    Check, Test Push, Turn On in Settings (when iOS has something off). Footer: Push's footer, then the background
    check's (its why-footers kept as they were).
  - Ignored Upgrades.

## Screenshot

`updates.png`: headless Chromium, the fake bridge in sideload mode (`capture.mjs --mode sideload`, copied from
b129's, plus fakes for `app.notifyStatus`, `push.*` and a stubbed `/api/push` that says enabled). The fresh profile
shows the auto-enable working: Push came on by itself before the page was opened.
Run: serve `web/app` on 127.0.0.1:8731, then
`APP_VERSION=0.12.0 node capture.mjs http://127.0.0.1:8731/ <outdir> script.json --mode sideload`.

## Not tested on a phone

- The auto-enable against the real APNs path (ifizbox.com still has no key), and that iOS gives a token without a
  prompt when notifications are already allowed.
- The `<NAME> Updates` switch on a real background check: that the shell stops badging and notifying iFizBox's own
  update after the list without it arrives.
