# B232: Change Installed Version installs another version

## What changed

- `web/app/screens/altstore.js`: the Installed group's **Change Installed Version** row (sideload and site, an app
  with a record and more than one version) now opens **Install Which Version?** (`installWhichVersion`): the
  source's versions newest first (`installWhichButtons`, sorted with `compareVersions`, numberless entries dropped),
  the installed one shown as `<version> (Installed)`. Tapping that one does nothing (the action sheet has no disabled
  buttons, and `nav/actionsheet.js` is outside this task's files; the nav bar's Reinstall covers it).
  A pick installs that version:
  - sideload: `appPageAction(pkg, source, { version })`, the same call Version History's row makes (queues that
    version's job, Confirm opens);
  - site: `siteInstallVersion(pkg, v, source)`, what Modify's Downgrade uses (signed in the browser, or Install in
    the app until website installs are on); it records the version once installed;
  - jailbreak: never reached (the row is hand-marking only), and the function returns null there anyway.
- Mark as Installed keeps its picker, retitled **Which Version Did You Install?** (`MARK_WHICH_TITLE`).
- `web/app/screens/altstore.test.js` (new): titles, sheet order/marking, sideload queue, site sign, Cancel / the
  installed row / jailbreak install nothing.

## Choice made

Version History on the sideload app, with a certificate, shows a second sheet of install rows (Install / Custom
Install) before queuing. Here the pick queues straight away (Confirm follows): one sheet after another would be
clunky, and Modify's Downgrade on the sideload app does the same direct queue.

## Spec review (fixed)

A fresh review found the first version offered every numbered version, where Version History greys out ones that
don't run on this iOS or have no download, and that it ignored appPageAction's false (no job / not ready), where
Version History falls back to its install rows. Fixed: `installWhichButtons` goes through `altVersionList` (runs &&
installable; the installed one stays listed, marked), the row shows only when the sheet has something to install,
a false from the queue runs the install rows' first row (`siteInstallVersion`), and the row's tap catches failures.

## Checks

- `node --test web/app/screens/`: 907 pass.
- `node tools/smoke/smoke.mjs --site`: passed (the generic smoke doesn't open an app page, so it only shows the
  module loads and nothing else broke).
- `tools/check.sh`: passed on the first commit; `done` runs it again on the final one.
- iPhone 15 Pro (iOS 27.0.1), Lite IPA built from this branch (`native/build.sh ipa`, the sheet code checked in the
  IPA), `tools/ui-15.sh`: OpenTennis (FIZL0 source) with Installed Version 1.8.4. Change Installed Version opened
  **Install Which Version?** with 1.8.5, **1.8.4 (Installed)**, 1.8.3 ... 1.6.5 newest first (`shots/sheet.png`).
  1.8.3 opened Confirm with **Downgrade OpenTennis** (`shots/confirm-downgrade.png`); Confirm downloaded
  `v1.8.3/opentennis-ios.ipa`, signed 1.8.3, iOS asked to install it and fetched the whole IPA; the run said
  "1 installed".
- **But the row did not show the new version** (`shots/after-row.png`: still 1.8.4, and the Installed tab still
  offers the upgrade to 1.8.5). That isn't this sheet: the queue run records an app only once `apps.isInstalled`
  confirms it (core/apprun.js `recordWhen`, B136/B170), and on iOS 27 that call never says yes (it answers
  false/nil for every app). The log said "Install watch ended: installed false; ... IPA fetched in full yes". Version
  History and Modify's Downgrade go through the same run and have the same gap. Filed as **B236**.
- iOS showed its install prompt a second time (the run opens the link again after 8 s with no prompt seen); I
  tapped Install both times. The second one reinstalled the same signed 1.8.3.

## Not verified

- "The row shows the new version" on the iPhone 15: it doesn't, because of B236 (the record waits for an iOS 27
  confirmation that never comes). The install itself ran to the end. The sheet's part (the record follows
  `onAppsChange` once written) is covered by the existing redraw and not by a phone test.
- The website's path (site mode: the pick signs in the browser via `siteInstallVersion`) is checked only by unit
  tests. Driving a full browser signing run needs a certificate in the browser, and this machine's headless smoke
  has none.
- OpenTennis on the iPhone 15 is now 1.8.3, but its record says 1.8.4. Left that way as test state: the phone is a
  test phone, and B236's fix will be tested against it.
