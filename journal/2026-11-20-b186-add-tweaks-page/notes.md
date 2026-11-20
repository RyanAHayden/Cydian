# B186 Add Tweaks page: pinstripes, scrolling, pushed with a back arrow

## What was wrong
`openAddTweaks` (web/app/screens/tweaks.js) put its groups straight into nav/sheet.js's `.sheet-body`. That box has
no `overflow` of its own (packages.css: the sheets that scroll put a `.sheet-scroll` inside it) and the `.sheet`
ground is `var(--plain)`, white. So the page didn't scroll (From Files stayed below the screen) and had a white
ground instead of the grouped pinstripes.

## What I did
- The body is now `sheet-scroll page-body grouped …`, as queue.js's Confirm and the other scrolling sheets: style.css
  `.page-body` scrolls (and clears the nav bar), ios6.css `.page-body.grouped` draws the pinstripes Settings has.
- User note on the task: a back arrow like other pushed pages and the push slide. New `showPushedPage` in tweaks.js:
  showSheet's scaffold with ios6.css's `.bar-button.back` on the left (labelled with the app's name, "Back" when over
  12 characters: `backLabel`) and no Done; showSheet's rise is cancelled and the page slides in from the right while
  the page under it (`.tab-stack.is-active > .page.is-top`) moves -30% and darkens and its nav item fades/moves
  -50%, as nav/transition.js's push. Back or Escape slides it out the same way, then closes the sheet without its
  slide-down. Transform/opacity only. Kept inside tweaks.js (no change to nav/sheet.js) to stay in the task's files.
- tweaks.css: From Files' label fills the row so its chevron sits at the right edge like its neighbours' (it sat
  right after the text: seen in the renders).
- Test: web/app/screens/tweaks-addpage.test.js (the body's classes, the back label, groups drawn into the scroller).

## Checked
3x renders in headless Chromium (a scratch copy of tools/smoke's CDP setup, fake bridge, 6 added tweaks to make the
page long) at 375x667 and 320x568: Settings for comparison, mid-push, top, scrolled to the bottom, mid-pop, after
Back. Scroll heights 702/667 and 721/568, overflow-y auto, background the pinstripe gradient; From Files fully
visible at the bottom (y 463-484 of 667, 345-366 of 568); Back removes the sheet and resolves openAddTweaks; no page
errors.

Tried that failed: the first 320x568 run showed the old code (Done button, white). The script picks a random
Chromium debug port 9400-9899, and it apparently attached to another slot's Chromium on the same port; a re-run
was right. Worth knowing for tools/smoke too.

## Not verified
- On a phone (iPhone 7 / an IPA build): not touched, the task didn't ask for it; checked in Chromium only.
- No edge swipe back on this page: it's not a routed page, so nav/swipe.js doesn't know it. Back button and Escape
  only.
- The tab bar is covered by the page (it's a full-screen sheet), as before; a routed push keeps the tab bar.
