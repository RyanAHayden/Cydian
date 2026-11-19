# B71a: AltStore apps queue in the jailbreak build (row swipe, hold menu, Modify)

## What was done

- **One queue store for apps in both builds.** The jailbreak build now uses `app-queue.js` (`appQueue`) too, beside
  apt's `installQueue`. `core/appqueue.js createAppQueue().add` takes Remove jobs (`op: "remove"`, or the row item's
  `app: "remove"`, mode `remove`, no url) and a second argument `{ quiet }`, so a swipe's add doesn't open Confirm.
  `appPlan` already had a `removes` list.
- **Confirm, Q'd badge and Queue button** (`screens/queue.js`, the jailbreak `openConfirm`/`updateChrome`): they count
  and list queued apps under the same Modifications as apt's packages. With only apps queued, apt isn't asked. If
  apt says nothing changes but apps are queued, Confirm still runs the apps. Cancel clears both queues. An app add
  that isn't quiet opens Confirm, as a package add does (`initQueue` subscribes to `appQueue`).
- **The run** (`runJailbreakApps`): apps go first, then the packages apt agreed to (`afterApps`), so a package's
  Restart SpringBoard can't cut the apps off. If AppSync's run took the packages, or the queue changed, Confirm asks
  apt again. For any install, `ensureAppSync` runs first (`appSyncFirst`, the same loop as `installWithAppSync`:
  its own Confirm, then the fallback alert with Try Again). Removes alone skip it. The apps run on the black page
  with rows (`screens/apprun.js runAppRun`) over new `helperLanes`:
  - the "sign" lane only runs the B72 MinimumOSVersion check (`ipaNeeds`);
  - installs go through `ipa-install.js runIpaInstall`, the same helper install-ipa call `installWithAppSync`'s
    console makes;
  - removes go through `backend.uninstallApp`, the call the Installed tab's `runDelete` makes.

  Jobs carry `helper: true`, so `core/apprun.js` uses the helper's words: Waiting, Checking, Installing 40%,
  Removing, Installed, Removed, and the summary "1 installed, 1 removed". There is no "Signed" or iOS prompt text.
  Each finished row leaves the queue and updates Installed's record (`recordInstall`, or `removeInstall` for a
  Remove). If AppSync was just installed, the bottom button is `ipaFinish`'s Restart SpringBoard (new
  `deps.finish` hook in `runAppRun`).
- **Rows** (`screens/browse.js`): in the jailbreak build, an AltStore app row swipes via the existing
  `attachQueueSwipe` with a new `item.kind === "ipa"` branch (`jbAppRowState`, which wraps
  `jailbreakAppRowState`). The swipe is quiet and shows the undo bar. The hold menu gets the same items; tapping one
  queues the app and opens Confirm. `rowMenuItems({ jbApps, queued })` now gives Cancel. Queued app rows show
  "Queued for …" like packages (`markQueued`). The sideload build's `attachAppSwipe` is untouched (the `apps`
  branch is still taken first for `queueKind() === "apps"`).
- **Modify** (`jbModifyQueue`, handed to `altstore.js jailbreakModify` as `install`/`remove`/`ask`): Upgrade,
  Reinstall, Downgrade and Remove now queue the app and open Confirm. Nothing installs at once, and Remove no longer
  opens the Delete confirmation sheet first. While the app is queued, the sheet starts with Clear. An app that is
  queued but not installed gets a Clear-only sheet. `altstore.js` was not edited.

Decision: Install on the page of an app that isn't installed still installs with one tap (B69's rule). The brief
names rows and Modify only, and the Install row also handles itms links and the original-app question. If the user
wants that queued too, it's a small follow-up in `packageActions`.

## Tests

`web/app/screens/jbappqueue.test.js` (10 tests): Remove jobs and quiet adds; Cancel on a queued row; the helper's
row words; `helperLanes` against fake helper calls; a full `runAppRun` over helper lanes (install then remove,
queue cleared, records, log steps, finish button); `runJailbreakApps` (AppSync stop, after/cancel, no second run);
`afterApps`; `appSyncFirst`; `jbModifyQueue` (queues at a version, Remove, Clear first). The existing
rowswipe/apprun/queue/jailbreakmodify tests still pass.

## Checked on the iPhone 7 (build 0.9.9-1722, 2026-11-19)

I grepped the installed web files for `jbAppRowState` and `runJailbreakApps` before testing. Screens are in
`ref/7/screens/b71a-*.png`.
- **Changes:** swiping OpenTennis (Available Upgrades) left gives "Queued for Upgrade", the undo bar "Upgrade
  OpenTennis queued", and Q'd on Installed. No Confirm opened. Installed's Queue button opened Confirm with
  Modifications "Install 2048, Upgrade OpenTennis". Confirm ran the apps' page ("Installing OpenTennis", the
  helper's "Installed io.github.fizl0.hst", "1 installed"), and after Done the packages' run followed (2048).
- **Search:** that swipe on "2048" queued an apt package (2048 is a .deb), so it didn't exercise app rows. I then
  searched "tennis" and swiped OpenTennis (installed, up to date): it showed "Queued for Remove" with no confirm
  popup. Confirm then ran "Removing OpenTennis" → helper "Uninstalled io.github.fizl0.hst" → "1 removed". A
  second swipe gave Install, and after Confirm OpenTennis was installed again.
- **Hold menu:** on a queued row it shows Cancel, Share, Source; Cancel took the app out. On the row it shows
  Install, Share, Source; Install opened Confirm (Statistics: Downloading 41.0 MB).
- **Modify** on the app page: Reinstall, Remove (red), Downgrade, Version History. Remove went straight to Confirm
  ("Remove OpenTennis"), with no Delete sheet. After Continue Queuing, Modify started with Clear, and Clear
  emptied the queue (the Q'd badge went away).
- I removed the 2048 test package over ssh afterwards. OpenTennis is installed at 1.8.0, as it was after the
  upgrade (its app data went with the Remove test).

## Not verified

- **The sideload (Lite) build's app-row swipe (F213 `attachAppSwipe`) on a phone.** There is no phone with the Lite
  build here, and the 7 runs the jailbreak .deb. The code path didn't change: `queueKind() === "apps"` still goes
  to `attachAppSwipe` before the new branch, and the only change it sees is that `restoreApp` passes
  `{ quiet: false }` to `appQueue.add`, which the sideload build ignores. `rowswipe-original.test.js` and
  `appqueue.test.js` still pass.
- **The AppSync Unified step inside an app run** (`appSyncFirst` → `ensureAppSync` with apt packages queued too).
  It's already installed on the 7, so it was only covered by unit tests. If AppSync is missing and apt packages are
  queued as well, AppSync's own Confirm also runs those packages, and its finish button (a respring) can come
  before the apps run.
- **Stop, Cancel and Retry on the helper rows on the phone.** `runIpaInstall` gets the row's abort signal, and
  `uninstall-app` can't be stopped once it has started. These are covered only by the shared `createAppRun` tests.
- **A run with an IPA that needs a newer iOS (the B72 check in the sign lane).** Covered only by a unit test.
