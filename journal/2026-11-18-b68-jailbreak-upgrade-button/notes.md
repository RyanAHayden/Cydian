# B68: Upgrade (N) missing in the jailbreak app's Changes

## Cause

In the jailbreak build `draw()` set the button from `upgradeJobs(available, vendorSold).length`. `upgradeJobs` drops
the remembered apps' rows (`remembered`, from app-updates.js `withAppUpgrades`; F87: apt has no package with an app's
bundle id), so whenever every listed upgrade was an app (IPA) upgrade the count was 0 and `drawUpgradeButton` hid
the button, even with rows under Available Upgrades. Finding and redrawing the button was fine: the sideload path
uses the same code and shows it.

## Fix (web/app/screens/changes.js)

- `appUpgradeRows(available, skip)`: the remembered apps' available rows. `jailbreakUpgradeCount`: apt jobs plus those.
  `draw()` uses it in the jailbreak build.
- `upgradeAllJailbreak(available, skip)`: what the jailbreak tap does now. Apt rows go to the install queue (Confirm
  opens, as before). Each app row becomes an IPA job (`queueUpgrades` with a no-op add, so it uses the source's
  IPA through `appJob`), sorted with `runOrder` (iFizBox last). The jobs are installed one after another through
  `ipa-install.js openIpaInstall` (AppSync Unified first, then the IPA console, remembered at the new version on
  success, as an app page's Install row is). When apt jobs are queued too, the apps wait for that run
  (`whenQueueRuns` on the last apt job, with a footer note in Confirm: "N app upgrades follow once these are
  installed."). If the run is cancelled or fails, no app is installed. A failed IPA stops the rest. Between apps the
  previous console is closed (`r.close()`) because only one IPA console can be up at a time; the last one stays open.
  Ignored upgrades never reach this: only `available` is passed.
- `upgradeEverything` (the Home Screen icon's Upgrade All shortcut) also went to the sideload app queue in the
  jailbreak build, which signs, and signing is refused there. It now takes the same `upgradeAllJailbreak` path.
- app-updates.js needed no change.

## Tests

`changes.test.js` "B68: …" covers the count when all upgrades are apps (it was 0 before the fix), the vendor-sold
skip, apps-only installs in turn with all but the last console closed, apt plus app (the app waits, and a cancelled
run installs none), and a failed install stopping the rest. The test fails on the old code: the functions it imports
didn't exist and the old count was `upgradeJobs(...).length` = 0. All `web/app/screens` tests pass (416).

## iPhone 7

I compared md5s: the phone's changes.js matched main. I checked that the phone's core/appqueue.js, core/installed.js,
screens/ipa-install.js and screens/queue.js export what the new file imports (runOrder, recordInstall,
openIpaInstall, whenQueueRuns). Then, under the ui-7.sh lock: swapped in the new changes.js (backup in /tmp), closed
iFizBox from the switcher, and opened ifizbox://changes. The tab loaded and drew normally with the new module.
Restored the original (md5 c038db4d… again), closed the app again, and unlocked.

To open the switcher, two `ui-7.sh home` calls in one command line are fast enough. Two separate tool calls only
switch home pages.

## Not verified

- **The Upgrade (N) count and tap on the phone.** The iPhone 7 has no available upgrades right now (Changes listed
  only "Today": iFizBox 0.9.8-1557 and OpenTennis 1.7.3, both installed), so the button is correctly hidden and the
  state the user saw can't be reproduced without making up an upgrade. I didn't install an older app to make one,
  because an IPA install on the 7 isn't safe to try unattended (see the test-IPA memory). Whether the remembered-app
  hypothesis matches the user's exact rows comes from the code, not from the phone.
- **The installs running in turn on a device** (closing one IPA console, then the next opening) were checked only
  with fakes in node.
- **The Home Screen shortcut path** (`upgradeEverything` in the jailbreak build) was checked by reading the code
  only: there is no shortcut driver in ui-7.sh.
