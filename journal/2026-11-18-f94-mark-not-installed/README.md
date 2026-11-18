# F94 Modify's Mark as Not Installed (2026-11-18)

## Done
- `core/appqueue.js`: `modifyActions` takes `build`: `"sideload"` / `"site"` add **Mark as Not Installed** last for
  an installed app (after Upgrade/Reinstall, Downgrade, Re-sign; also when it's queued), `"jailbreak"` adds **Remove**,
  no build adds neither (the old calls keep their lists). `MARK_NOT_INSTALLED` and `destructiveOf(buttons)` give the
  sheet its red button index.
- `screens/altstore.js` `appPageAction`:
  - sideload app: the Modify sheet passes `build: "sideload"` and `destructive`; Mark as Not Installed calls
    `forget` (default `removeInstall(await store(), id)`), queues nothing. The Installed section redraws through
    `onAppsChange`, which `removeInstall` fires.
  - website: before, the nav button read Modify for an installed app but tapping it just installed. Now
    `siteModify` shows the sheet: Upgrade/Reinstall resolve false, so browse.js `packageActions` installs the newest
    as before (signed in the browser); Downgrade asks which version and installs it through `installRows`'s first row
    (`siteInstallVersion`, recorded on success like browse.js `recordApp`); Mark as Not Installed forgets the record.
    Not installed, or Version History's per-version Install: false, unchanged.
  - jailbreak build: unchanged. Its app page never had a Modify sheet for IPAs (the nav button installs through the
    helper), and an app's "Remove" there would need an apt/helper uninstall that doesn't exist for IPAs. So
    `modifyActions` says Remove for that build, as the brief asks, but nothing in the jailbreak build calls it for apps.
    Debs keep browse.js's queued apt Remove.
- Tests: `screens/marknotinstalled.test.js` (modifyActions per build, destructive index, record removed in the sideload
  app and on the website, website Upgrade/Downgrade paths, jailbreak untouched). Existing expectations in
  `screens/appqueue.test.js` and `screens/resignqueue.test.js` gained the new last button; the website case there
  now answers the sheet.

## Decisions
- On a queued and installed app the button still shows and forgets only the record; the queued job stays (clearing
  it is Clear's job).

## Not verified
- The sheet on a real iPhone / browser (the red button's look): no device or browser session in this unattended run;
  the destructive style is actionsheet.js's existing `.destructive`, already used by My IPAs' Delete IPA.
- The website's Downgrade install end to end (browser zsign signing): it calls installRows' existing Install row,
  covered by F93's own tests, not exercised here.
