# F255: jailbreak Upgrade (N) and app-page Install queue apps in the app queue

## What changed

- `web/app/screens/changes.js` `upgradeAllJailbreak`: Changes' Upgrade (N) in the jailbreak app still puts apt's rows
  in the install queue. Each remembered app's upgrade (an IPA) now goes into the app queue (`app-queue.js`) too, in
  `runOrder`, using normal adds (not quiet ones). So one Confirm sheet lists both kinds, and its Confirm runs the apps
  through `screens/queue.js runJailbreakApps` (AppSync first, then the helper's install-ipa on the black page with
  rows), followed by apt's packages. Before this, B68 waited for apt's run and then opened one `openIpaInstall` console
  per app. That code (`installIpaJob`, the `whenQueueRuns` wait, and the `install`/`wait` options) is gone. Recording
  each app at its new version is now done by the run itself (`recordJbApp` → `recordApp`).
  Returns `{ apt, apps }`. `upgradeEverything` (the Home Screen Upgrade All) gets the same behaviour through it.
- `web/app/screens/browse.js` `packageActions`: if an app page's app isn't installed and the jailbreak app queue
  applies (`jbAppQueue()`), Install now queues it through `jbModifyQueue(...).install(v)`. Confirm opens, the same as
  for a row's Install. The old install-at-once path (B69) is kept only for an app with no IPA the helper can install
  (`appJob` returns null, e.g. a source-signed itms-services link).
  I left out the original-app warning (F246), which the sideload build asks before a fresh install. B71a's row swipe
  and hold-menu Install in the jailbreak build don't ask it either, and that warning is about signing.

## Tests

- `screens/changes.test.js`: the B68 test now covers only the count. A new F255 test checks the following.
  - When only apps are listed, each one becomes an upgrade job in the app queue, with normal adds.
  - When both kinds are listed, apt's row goes to the install queue and the app goes to the app queue.
  - A row the catalog doesn't know brings its own IPA; a row with no IPA is left out; vendor-sold rows are skipped.
- New `screens/jbinstallqueue.test.js`: a not-installed Install through `jbModifyQueue` makes an install job with a
  normal add. A source-order check makes sure `packageActions` queues after `jailbreakModify` and before the one-tap
  `rows[0].onClick()`, and only when `appJob` returns a job.

## Not verified

- **On the iPhone 7: Upgrade (N) with an app upgrade in Changes.** Not checked. I took the ui-7.sh lock and opened
  Changes. The phone's web files matched main (md5). Changes listed no available upgrades at all: OpenTennis was
  already recorded at 1.8.0, the newest. Getting an app upgrade to show would mean writing an older version into the
  app's IndexedDB record or installing an older IPA. Both change state that other slots test against, so I didn't swap
  files or run anything. To check it: make a remembered app older than its source (Modify > Downgrade on an app page,
  then Changes), tap Upgrade (N), and look for the app under Confirm's Modifications next to any apt packages.
- **On the iPhone 7: the not-installed app page's Install.** Not checked, for the same reason. The phone notes also
  say not to tap Install on an app page there, because it used to install at once.
