# B40: F204's reload bar on the iPhone 7

User note (2026-11-18): "the reloading data change puts it underneath the bottom navbar". F204 was still running
when that note landed, so this task checked the bar after F204 merged.

## What I did

- Built the .deb from this branch (main at f911d18, `com.ryha.ifizbox` 0.9.7-1352). Installed it on the 7 over
  0.9.6-1335 with `apt-get install`.
- Drove the phone with `tools/ui-7.sh` under lock B40. Waited for B46 to release it first. Screenshots are in
  `ref/7/screens/b40-*.png`:
  - `b40-reload-1/2`: Home scrolled to the bottom, Reload tapped. The strip ("Updating Sources", spinner, Cancel) is
    fully visible and sits flush on top of the tab bar. The last line (the device/version footer) is ~28 pt clear
    of it.
  - `b40-inst-base`: Installed at the end, no reload. The last row (vi) is 20 pt above the tab bar, from the page's
    `--tab-h + 20px` padding.
  - `b40-inst-reload-end-2`: reload running, Installed scrolled to the end. vi scrolls clear of the strip because
    of the html.has-reload `::after` room (44 pt). The strip is fully visible above the tab bar.
    (`b40-installed-reload` shows vi under the strip only because the list was not yet at its end. A swipe brings it
    clear.)
  - `b40-sheet-reload/-2`: reload running with the Confirm sheet open (unzip > Modify > Reinstall, then Cancelled).
    There is no tab bar over a sheet, so the strip sits at the bottom of the screen, fully visible, over the sheet
    (B26's `body:has(.sheet)` rule).
- Result: on the current build the bar is never behind or under the tab bar, and the last row clears both. No change
  to ios6.css or reloadbar.js was needed. The user's note most likely describes the build from before F204.
- Added a test to `web/app/ios6-css.test.js` (B40) that pins the geometry checked on the phone:
  - the bar's bottom is `--tab-h`, the same value as the tab bar's height (`bottom: 0`);
  - its z-index is above `#screens` and below `.tabbar` (the old test only checked "< 3", so it could have slipped
    behind the page);
  - nothing translates it while idle;
  - the scroller end room is at least the bar's height and clears the rubber-band float;
  - over a sheet it drops by exactly `--tab-h - safe-area-inset-bottom`.
- Filed B51 (low): the section index (A–Z) on Installed/Sources runs behind the strip, so Y and Z are covered while a
  reload shows. That's in packages.css, outside this task.

## Tried and failed

- My first tap on the Modify action sheet came while it was still sliding up, and hit Remove instead of Reinstall. The
  Confirm sheet then offered "Remove iFizBox, unzip" (iFizBox depends on unzip). I cancelled it and confirmed
  nothing. Wait about 1 s after opening an action sheet before tapping it.

## Not verified

- Dark theme and the iPhone X-style safe-area bottom inset: the 7 has no home indicator (inset 0), and I didn't switch
  themes. The geometry is the same CSS variables, so the new test covers the formula, not a render.
- The exact "Reloading Data" step text was never on screen in a screenshot. Every capture showed "Updating Sources".
  The steps share one strip, so the position is the same.
- The bar sliding away behind the tab bar at the end of a reload: not caught in a screenshot, because ui-7.sh shots
  are too slow for a 250 ms slide.
