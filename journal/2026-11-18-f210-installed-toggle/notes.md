# F210: one-tap Installed toggle in the IPA app page's nav bar

## What it does

- `screens/altstore.js`: `markToggle(app, pkg, source)` makes a bordered icon bar button (`bar-button bar-icon
  mark-toggle`). It shows an outline circled check while the app isn't installed ("Mark as Installed") and a filled one
  with the check cut out while it is, whether iFizBox installed it or it was marked ("Mark as Not Installed"). The
  aria-label always says what a tap will do.
  A tap calls `toggleMarked`: with no record it writes the same record as the Tracking section's Mark as Installed,
  at the source's latest version, with no picker; with a record it calls `removeInstall`. Then a haptic
  (`nav/haptic.js`) and a HUD (`showHUD("").done("Marked as Installed" | "Marked as Not Installed", 900)`).
  record/remove fire `onAppsChange`, so the Tracking section, the nav label (Install/Reinstall) and Changes update
  as they do for the rows. `renderApp` refreshes the icon on every `onAppsChange`, so an install or the Tracking rows
  move it too. The Tracking section's Mark rows are unchanged.
- `markToggleApplies(app)`: hidden for iFizBox's own app (bundle ID `BUNDLE_ID` or `BUNDLE_ID.*`, or an
  `isSelfIpa` download) and for an app with no bundle ID or no version. That is how I read "where marking doesn't
  apply", because the Tracking section is shown in all three builds (F88 put it in the jailbreak app too). So the
  toggle shows in the jailbreak app, the sideload app and on the website.
- `nav/navbar.js` (new): `navItemOf(body)` and `addNavIcon(body, button, key)`. The icon is **appended after** Install
  in the DOM and drawn on its left with CSS `order` (`.nav-icon-left` 1, the page's button `.nav-after-icon` 2,
  Share keeps 0). This matters because `browse.js setRightLabel` relabels
  `querySelector(".nav-right .bar-button:not(.share-button)")`, the first match, so an icon put before Install would
  have been relabelled "Modify". A page drawn again replaces its icon (same key) instead of adding a second one.
- 320pt fit: the nav item's grid has two equal side columns, so the title's cap sets their width. With the icon,
  `.nav-item.has-nav-icon .nav-title` is capped at `100vw - 240px`, which leaves room for 34 + 5 + a "Reinstall"
  button. A long title ends in "…" and never overlaps (see `nav-320.png`, rows 3 and 4). A short title is not
  affected.

## Checks

- `screens/altstore-marktoggle.test.js`: the first tap records the latest version with the right key, source and
  icon; the second forgets it. The icon class and aria-label follow taps and outside record changes. An app iFizBox
  installed at an older version shows filled, and a tap forgets it. With no store, no HUD. Hidden for our own app
  and for an app with nothing to mark. addNavIcon ordering and replacement.
- Rendered with headless Chromium, using the real `style.css`/`ios6.css`/`altstore.css` in a harness
  (`nav.html`): `nav-320.png` (320pt @3x) and `nav-375.png` (375pt @2x, the iPhone 7's width). Outline and filled
  states, short and long titles, Install and Reinstall, and a row without the toggle for comparison.

## Tried, didn't work

- iPhone 7 screenshot: I backed up and swapped the 4 changed web files into the installed app (the installed
  `style.css`, `altstore.css` and `screens/altstore.js` had the same md5 as this branch's base), closed the app from the
  switcher, then opened `ifizbox://package?id=com.rileytestut.Delta`: "Package not found". The phone has no AltStore
  source (APT sources only), so no IPA app page exists there. I didn't add a source to the shared test phone just for
  a screenshot. I restored the original files (md5 checked) and closed the app again, so it relaunches on them. The
  phone is as it was. While doing this I briefly overwrote my phone-side backup dir with the new files; the originals
  came back from `git show HEAD:` (same md5), so nothing was lost.

## Not verified

- **The toggle on the iPhone 7** (look, haptic, HUD, tap): the phone has no AltStore source, so it has no IPA app
  page (above). What would check it: add an AltStore source on the phone (or a run that installs this build after an
  AltStore source is added), open an app page, take a `tools/ui-7.sh` shot, tap twice.
- **The live website's app page**: the static server can't load AltStore sources without the Worker's `/api/fetch`
  proxy, so I rendered the nav bar in a harness with the real CSS instead of the real page. What the page wiring adds
  (`renderApp` → `addNavIcon` → the real nav item, onAppsChange refresh) is covered only by the unit tests and fakes.
- **The real Helvetica Neue width of "Reinstall"**: Chromium on Linux substitutes a wider font. The 240px cap fits it
  there, so it should fit on iOS, but I didn't measure it on a phone.
- **Haptic in Safari from a click**: `haptic()` runs in the click handler. In the app the bridge ticks any time; in
  Safari the switch trick needs a touch gesture, and a click after touchend should count, but I didn't check it on
  a phone.
