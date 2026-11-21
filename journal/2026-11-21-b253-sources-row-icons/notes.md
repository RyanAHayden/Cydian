# B253: Sources tab row icons on one column

## Cause
- Source rows: a 29pt `.cell-icon` at the cell's 10pt padding, the title one `--cell-gap` (8pt) after: x 10, title 47.
- All Sources: Sections' `.folder`, 32pt (Cydia's folder.png size on Sections), so the title sat at 50.
- More Sources: `rowIcon("moreSources")`, a Settings `.row-icon`, which carries the Settings-table nudge
  (`--row-icon-in: -3px`, `--row-icon-after: 3px`), so its tile started at x 7 (title still 47).

## Fix
- `screens/sources.js` puts `sources-list` on the tab's list; `packages.css` draws the folder at 29pt there (art
  scaled with `background-size`) and zeroes the plus tile's margins there. Scoped to the Sources tab: Sections keeps
  its 32pt folder (Cydia's), Home and Manage keep More Sources' Settings placement.
- Reference geometry is the source rows', as the task asked (docs/cydia.md says folder.png is 32x32 on Sections;
  on the Sources tab it now matches the 29pt source icons instead).
- `web/app/sources-row-icons.test.js` pins it (sizes against style.css's `.cell-icon`, the margin, the class).

## Rendered check (headless Chromium, 402x874 at 3x, `srcshot.mjs` here)
Icon box [x, y-in-row, w, h, centre offset] and title x per row:

| build | All Sources | More Sources | source rows |
|---|---|---|---|
| main, jailbroken | 10, 32x32, title 50 | **7**, 29x29, title 47 | 10, 29x29, title 47 |
| B253, jailbroken | 10, 29x29, title 47 | 10, 29x29, title 47 | 10, 29x29, title 47 |
| B253, sideload (App + Tweak Sources groups) | same | same | same |
| B253, site | same | same | same |
| B253, iOS 7 era | 15, title 52 | 15, title 52 | 15, title 52 |

Subtitles start at the title's x in every row; every icon's centre is within 0.5pt of its row's centre (the
row's 1px keyline). `before-after-3x.png`: sideload, main on the left, B253 on the right.

More Sources' row stays shorter than the 53pt source rows (it is not a `.source-row`); its icon is centred in it.
Height wasn't part of the ask, so I left it as it is.

## Not verified
- On the iPhone 15 Pro itself: the render is Chromium at the 15 Pro's 3x and the same CSS, not the phone's WebKit.
  The geometry here is plain flex/box sizing with no WebKit-specific rule, so I didn't drive the phone for it.
- iOS 7 keyline under All Sources: ios7.css starts a plain row's keyline at the title only for rows with a
  `.cell-icon`, so the folder row's keyline still starts at 15pt. ios7.css isn't in this task's files.
