# F195: the package page's info tiles as one grouped card

User 2026-11-18 chose concept B (first mock, 3 columns): one iOS 6 grouped card split into columns instead of
separate fixed 92px tiles, which left ~70pt dead on the right of the iPhone 7 and clipped "iOS 5–1…".

## What I did
- `web/app/packages.css` `.store-tiles`: now the card itself: `var(--table)` background, `var(--table-edge)` border,
  9.5px corners, the grouped table's inset top shadow, margin `16px 10px 0` (the same 10px sides as
  `.store-segmented` in ios6.css). `.store-tile` columns are `flex: 1 1 0`, no own background/border; between columns
  the iOS 6 divider as inset shadows (1px `--divider`, then 1px `--divider-hi`). With 5 (or 6) columns
  (`data-count`), columns are `width: 29%` and the card scrolls sideways inside itself with snap, so the 4th
  peeks. Values 17px -> 15px bold; labels unchanged (10px caps). `.store-tiles:empty` hides.
- `storepage.js` `tileRow()` keeps `row.dataset.count` = number of tiles on every set (add or remove).
- `sizeTile(text, price = null)`: value is the whole size with its unit ("48 kB"), sub is the price or nothing.
- Callers (outside the brief's files, one line each, so the "Free" line shows): `browse.js` passes the same price
  the header line shows (null for installed-only, "Paid"/"Free"); `altstore.js` passes "Free" (its header says
  Free). Decision: the brief says sub "'Free' or blank"; a paid package shows "Paid" there, matching its header.
- Tests: F181 test updated (value "412 kB", no sub, count 5); new F195 test for sizeTile, count, and the CSS rules.

## Checks
- `node --test web/app/screens/`: 241 pass.
- iPhone 7: built `native/build.sh deb` (com.ryha.cydian 0.9.2-1118, this branch), installed over 0.9.1-1092,
  opened `cydian://package?id=ai.akemi.appsyncunified` (3 tiles) under ui-7 lock F195. Card's left/right edges sit
  exactly under the segmented control's (zoomed crop of the 2x shot), "iOS 5–18.2", "48 kB / Free",
  "Tweaks / Rootless" all whole, divider shadow+highlight visible. Screens: `ref/7/screens/f195-appsync.png`.
- 3x headless Chromium render (375pt wide, real style/ios6/packages CSS, light and dark), 3 and 5 columns: 5 columns
  scroll with the 4th peeking at the right edge; dark theme uses the dark table/divider colours, green/red subs ok.

## Not verified
- A 5-tile page on the iPhone 7 itself: the phone has no AltStore source (`cydian://package?id=com.rileytestut.Delta`
  -> Package not found), and I didn't add sources to the shared test phone. 5 columns were checked in Chromium only;
  the sideways swipe/snap inside the card was not tried by touch.
- Dark theme on the phone: not switched (a persistent setting on the shared phone); checked in Chromium at 3x.
- The phone is left on this branch's build 0.9.2-1118 (the next merged deb will replace it).
