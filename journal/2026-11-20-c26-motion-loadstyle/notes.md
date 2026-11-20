# C26: nav/motion.js and one loadStyle

## Done
- New `web/app/nav/motion.js`: `EASE` (iOS 6's `cubic-bezier(.25,.1,.25,1)`), `DURATION` (300 ms), `SHEET_IN`
  (350 ms: a sheet rising, and the navigation push) and `loadStyle(name)`, which links a web/app stylesheet once
  per page (one Set, so signsheet.css, which three modules load, is now linked once instead of up to three times).
- nav/: sheet, actionsheet, sharesheet, progress, banner, reloadbar, ui, rowswipe import the curve and durations;
  slide.js re-exports `DURATION`/`EASE` from motion.js (slide.test.js and other importers are unchanged);
  transition.js's push `DURATION` is `SHEET_IN`. Its own navigation curves (`.36,.66,.04,1`, `.2,.8,.4,1`) stay
  there: they are different curves, used only there.
- Outside nav/ (the brief lists only `web/app/nav/**`, but its text says "replace the copies" and the check
  "grep finds the curve only in nav/motion.js and the CSS", and all 7 style() copies live outside nav/): the
  private loaders in screens/signing, signed-apps, settings, free-apple-id, tweaks, myipas and signing-sheet.js
  became one-line `function style() { loadStyle("x.css"); }`, so call sites stay as they were (small diff, clean
  merges). Curve literals in screens/search, altstore, installroute and settings use the import.
- Values kept exactly: sharesheet/actionsheet still rise in 300 ms, sheet/progress in 350; search's 280 ms
  stays a literal (only one user).
- `nav/motion.test.js`: the constants, loadStyle's once-only and no-document behaviour, and a scan that the curve
  appears in no app .js module but motion.js.

## Not tried / left alone
- Other one-off curves (scroller's bounce, pullrefresh, roulette, settings' split spring) are distinct and unique;
  left in place.

## Not verified
- No look at the running app on a phone or browser: the change only renames values (same numbers, same URLs), and
  `node --test` (2458 pass) covers the sheet animation options. The stylesheet URL resolves from nav/ now
  (`../name`); the test checks it ends in `/web/app/<name>`.
