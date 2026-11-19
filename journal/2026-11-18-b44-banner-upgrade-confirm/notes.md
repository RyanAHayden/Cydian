# B44: the update banner's Upgrade goes straight to Confirm

## What changed

- `web/app/screens/changes.js` `upgradeSelf()`: waits for the catalog (up to 20 s), finds iFizBox's own row
  (`com.ryha.ifizbox`, `core/essential.js SELF_ID`) in Available Upgrades and queues only that row, the same way
  Changes queues it:
  - jailbreak: `upgradeAll(queueFn(), [row])`, i.e. the backend's install queue. `screens/queue.js initQueue` opens
    Confirm on an add that isn't quiet. Nothing in queue.js had to be exported.
  - sideload: `queueUpgrades([row])` puts it in the app queue with its IPA, and `queueApp` opens `openAppConfirm`.
  - No row by then (catalog not loaded or failed, apt's repo not refreshed yet, the upgrade ignored, no backend
    queue): it opens Changes, as the banner did before.
- `web/app/essential-ui.js`: the banner's Upgrade calls `bannerUpgrade()`, which loads `screens/changes.js` with a
  dynamic import (changes.js already imports essential-ui.js, so a static import would be circular) and runs
  `upgradeSelf()`.
- User request during the task: after Upgrade and then Confirm's Cancel, the banner never came back, because it
  showed only once per version per session. Now a tap on Upgrade resets that `once` (`bannerSeen.version = null`).
  `bannerDue()` keeps the banner hidden while iFizBox is still in either queue, so it comes back at the next check
  (launch, Home's Reload, coming back to the app) once the job has been cancelled.
- Tests: `web/app/screens/upgradeself.test.js` covers both modes queuing exactly iFizBox's upgrade and opening Confirm
  (a non-quiet add in jailbreak, the open call in sideload), the fall-back to Changes (no row, a failing catalog, a
  catalog that never answers), the banner calling `upgradeSelf`, and the banner coming back after a Cancel.

## On the iPhone 7

- Built a test .deb as 0.9.6-1465: I changed `native/VERSION` to 0.9.6 for the build only and set it back after,
  so it is not in the commit. Installed it with `--allow-downgrades` over 0.9.7-1445. On launch the banner
  "iFizBox 0.9.7 is out." came up (`ref/7/screens/b44-banner.png`).
- My taps on Upgrade landed on Sources, three times. About 2-3 s after launch the "Source Failed to Refresh" banner
  (palera1n's repo fails on this phone) replaces the update banner (`b44-banner2.png`). It opens Sources when tapped.
  The screenshot round-trip takes about as long as that, so the race was hard to win. Filed as **B62**.
- The user tapped Upgrade on the phone themselves and said Confirm popped up. My next relaunch then closed it.
  After that, Installed showed Q'd (the upgrade was queued), and then the web view reloaded on its own, so I stopped
  driving the screen while the user was using it.

## Not verified

- **No screenshot of Confirm** (`ref/7/screens/` has the banner, not Confirm): the failure banner kept winning the race
  (B62). The user saw Confirm open on the phone, but I have no picture of it.
- The banner coming back after Cancel was not tried on the phone. Only the node test covers it.
- Sideload mode was not run on a device (the 7 runs the jailbreak build). Only the node test covers it.
- Why the web view reloaded during my last taps (it was not a relaunch of mine) was not looked into.
- The phone now has iFizBox 0.9.6-1465 built from this branch. I put 0.9.7 back after the gate (see below) if that
  worked.
