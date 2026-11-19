# B71: swiping a row left on the iPhone 7 (jailbreak .deb 0.9.8-1605)

## What I found on the phone

Driven with `tools/ui-7.sh` under the B71 lock.

- Apt rows swipe fine with the build as installed. In Changes, iFizBox's own row swiped to "Queued for Remove" with the
  undo bar, and a second swipe cancelled it. Touch handling, the scroller and `queueOf()` at attach time all work:
  `.pkg-row { touch-action: pan-y }` holds on iOS 15's WKWebView.
- **App rows (kind `ipa`) do nothing** in the jailbreak build (OpenTennis in Changes). That was the report: the
  apt queue is the build's only queue, and `rowMenuItems` gives `ipa` rows no queue item there.
- The user (mid-session) added three rules:
  1. iFizBox must never queue its own Remove: not from a swipe, not from the hold menu, not from the package page's
     Modify. Only Upgrade, Reinstall, Downgrade and the rest.
  2. An app row's swipe must just add to a queue: no install at once, and no confirm popup for Remove.
  3. Queueing apps must also work in the Lite (sideload) build.

## What changed (web/app/screens/browse.js)

- `rowMenuItems`: iFizBox's own package (brand.js `PACKAGE`) gets Upgrade when a newer version is out, Reinstall when
  a source has the installed version, Install when it isn't installed, and Cancel when queued. It never gets Remove. The swipe
  (`rowSwipeAction`) follows, since it reads the same items.
- The package page's Modify sheet leaves out Remove for iFizBox.
- Pure groundwork for B71a: `rowMenuItems({ jbApps, job, installed, newest })` (an app's Install / Upgrade / Remove
  in the jailbreak build) and `jailbreakAppRowState(item, { pkg, rec })` (the job, installed and newest from the
  catalog package, the apps store's record, or Changes' remembered upgrade row). Nothing calls them yet.
- Test: `web/app/screens/rowswipe-jailbreak.test.js`. It failed before the change (missing exports; the self rows
  listed Remove) and passes after.

## Tried and dropped

- First version: in the jailbreak build an app row's swipe installed at once through the helper's IPA console
  (`openIpaInstall`), and Remove opened the Installed tab's Delete sheet. On the 7 the swipe on OpenTennis opened
  "Delete OpenTennis / Cancel". The user rejected it: a swipe should only queue. A real queue for apps in the
  jailbreak build needs the Confirm sheet, the Q'd badge and a run through the helper (screens/queue.js, apprun.js,
  core/appqueue.js), which other slots are editing and B71's files don't cover. So it is split off as **B71a**,
  and the at-once wiring was taken out again.

## Checked on the iPhone 7

I swapped in this branch's web files: six files differed from 1605, and every other web file's md5 matched the
branch. I backed up the six first, then closed and reopened the app from the switcher.
- Changes: iFizBox's row no longer swipes to Remove. The installed 1605 is newer than the 1557 its source lists, so
  the row now has no action.
- Search ("you"): YouGroupSettings swiped to "Queued for Install" with the undo bar, and a second swipe showed "Install
  YouGroupSettings cancelled".
- iFizBox's package page > Modify: Downgrade and Cancel only, no Remove.
- I put the phone's original six files back afterwards (browse.js md5 matches the 1605 copy again) and closed the app.

## Follow-ups filed

- **B71a**: the jailbreak build's app queue (swipe, hold menu and Modify queue apps quietly; Confirm runs them
  through the helper). Lite's F213 swipe must keep working.
- **B73**: iFizBox's own APT source lists only the newest release (`tools/selfrepo.py` over one release's .debs;
  `Filename:` resolves via `releases/latest/download/`), so Downgrade and Version History show one version.

## Not verified

- Swiping an app row in the jailbreak build: nothing to verify in B71 (it stays without a swipe until B71a).
- Lite (sideload) build: the app-row swipe (F213) is untouched by this change, but I didn't run it on a phone. The
  iPhone 7 has the jailbreak build, and there is no Lite test phone in this session.
- Reinstall on iFizBox's up-to-date row: not seen on the phone. Its installed version (1605) is newer than its
  source's (1557), so that row shows no action. Unit tests cover it.
- Other places that can still queue a remove by id: Confirm's conflict-fix "remove" rows (screens/queue.js
  actionRow) and the malware alert's Remove (installed.js). They are not row or page queueing and never name
  iFizBox in practice. I left them alone: they're outside B71's files.
- Real-finger swipes: phonectl sends HID touches as the built-in touchscreen, which is the same input path as a
  finger, but no person swiped.
