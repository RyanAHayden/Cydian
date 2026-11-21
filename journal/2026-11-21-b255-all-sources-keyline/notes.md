# B255: iOS 7 All Sources keyline at the title

## Cause
ios7.css moves a plain row's keyline from 15pt to the title (15 + 29 + --cell-gap) only for rows whose
`.cell-inner` holds a `.cell-icon`. The All Sources row's icon is a `.folder` (29pt on the Sources tab since B253),
so its keyline stayed at 15pt.

## Fix
`ios7.css`: `.sources-list .all-sources-row` added to that rule's selector list. Scoped to the Sources tab rather
than any `.folder` row: Sections draws a 32pt folder at 7pt in (title at 48), which this offset would not fit.
`web/app/sources-keyline.test.js` pins the selector and the 29pt folder the offset assumes.

## Rendered check (headless Chromium, 402x874 at 3x, iOS 7 era, jailbroken fake bridge; `srcshot.mjs` here)
Every row on the tab: icon x 15, 29x29, title x 52, keyline (background-position-x) 52px: All Sources, More
Sources, iFizBox, Chariz, Havoc, repo.packix.com. Screenshot looked at: the line under All Sources now starts
under "All Sources", the same column as the lines under the source rows.

## Not verified
- On a phone: Chromium render only, same CSS; the rule is a plain selector addition, so I didn't drive the 15 Pro.
- The site and sideload variants of the tab in the iOS 7 era: same list, same classes (B253 showed identical
  geometry across builds), not re-rendered.
