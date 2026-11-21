# F346: hold Install to pick the version

## What changed

- `nav/menu.js` `holdButton(button, onHold)`: `longPress` (HOLD_MS, 550 ms) on one button. The tap's click is
  eaten after a hold and the context menu is prevented. The body already turns the callout off
  (`-webkit-touch-callout: none`), and app.js's `.is-pressed` gives the held look while the finger is down, so
  nothing new was needed for those.
- `app.js` `button(spec)`: a nav spec with `onHold` gets `holdButton`. Only the package page's right button has one.
- `screens/browse.js`: the package route's nav spec has `onHold: installVersionHold(route)`. The label doesn't matter:
  Install, Modify, Upgrade, Reinstall and the paid price label all hold the same way. Add to App (a sideload tweak)
  doesn't.
  - Apps: `installWhichVersion` (B232's sheet and install) with the installed version taken from the apps store. The
    sideload app queues the version, the site signs it, and the jailbreak app uses its new `jailbreakInstall` option:
    that version's IPA job in the app queue where the helper runs it (`jbModifyQueue().install`), else the version's
    first install row (the same thing Modify's install does).
  - Packages: `packageWhichButtons` / `packageWhichVersion`: Version History's versions that some source still
    offers, newest first, the installed one marked "(Installed)" and not installable. A pick goes in the install
    queue (`op: install, version`), the same job Modify > Downgrade's list queues. On the website (no queue) a pick
    downloads that version's .deb, as Version History's rows do there. A package its vendor sells gets no sheet,
    because apt can't fetch it.
- `screens/altstore.js` `installWhichVersion`: new `jailbreakInstall` option. Without it the jailbreak app still
  installs nothing from here. Change Installed Version doesn't pass it, so its rows behave as before.
- Test: `screens/installhold.test.js`.

## Choices

- Packages use the same sheet title ("Install Which Version?") and the same "(Installed)" marking as apps, so the
  hold looks the same everywhere.
- A sheet that would list only the installed version doesn't open. The hold then does nothing (as B232).
- A paid package its vendor sells gets no sheet when held, even on its price button. Modify doesn't offer a
  Downgrade for those either (`paidActions`), because apt can't fetch them; only the vendor's Download & Install can.
- A package's list doesn't filter versions by iOS. Modify > Downgrade's list and Version History don't either: the
  stanza doesn't say which iOS a version runs on, only its dependencies do, and apt checks those when it installs.
- In the jailbreak app an app's installed version comes from the apps store record. `jbModifyQueue` reads the same
  record, and the helper writes it when an install ends (F88). An app installed outside iFizBox has no record, so
  its sheet has no "(Installed)" row.

## Checked on the iPhone 15 Pro

Built the sideload IPA from this branch (`native/build.sh ipa`) and installed it with `tools/ui-15.sh` (lock F346).
On iFizBox's own app page (Modify), a 0.9 s hold (`swipe x y x y 0.9`) opened "Install Which Version?" with
"0.18.3 (Installed)" first and 0.18.2 to 0.14.0 below. Modify's own sheet did not open with it. Cancel closed the
sheet and installed nothing. A plain tap then opened Modify's sheet (Reinstall, Downgrade, Re-sign, Mark as Not
Installed) as before. Screenshots: `ref/15/screens/f346-f.png` (the hold) and `f346-g.png` (the tap).

## Not verified

- Picking a version on the phone. Only iFizBox's own source was added on the 15, and downgrading iFizBox would
  replace the build under test. The pick's path is B232's `installWhichVersion` (node-tested), unchanged for the
  sideload app.
- The jailbreak app on the iPhone 7 and APT packages on a phone. The task asks for the 15 only. Node tests cover
  the APT sheet and queue job (`packageWhichVersion`) and the jailbreak install hook.
- The website in a browser (the hold on a package's Install that downloads the .deb). Node test only.
- Seeing the held (pressed) look on the button mid-hold. It is app.js's `.is-pressed`, which every bar button already
  gets on pointerdown, and no shot was taken while the finger was down.
