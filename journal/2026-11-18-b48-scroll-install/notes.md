# B48: scrolling on an app page started an install

User 2026-11-18: "I was scrolling on an app page … it started installing the app when I was just trying to scroll."

## The paths found

1. **The app page's Install rows** (`altstore.js installRows`: Install / Install IPA / Custom Install / Download IPA,
   and the website's gate rows) were plain `click` handlers on `button.cell-inner` (nav/ui.js `cell`). Nothing in the
   page told a tap from the end of a drag. In the jailbreak app Install goes straight to the helper (no Confirm), so a
   stray click installs at once. iOS can still send `click` after a short drag that never became a pan (the tap
   recogniser allows more movement than the pan needs to start, and the native shell has `scrollView.bounces = false`,
   so at the ends of a pane a drag may never pan), or after the pane moved under a resting finger. I couldn't get a
   real iOS click after a scroll on the phone with phonectl's synthetic swipes, so which of these the user hit is
   not proven; the fix covers all of them.
2. **Hold menus** (nav/menu.js `longPress` + `showMenu`): the 500 ms hold fired while a finger rested before a slow
   scroll; pointermove stops coming once iOS pans, so only moves inside the list cancelled it, never the pane
   scrolling. The menu is in `document.body`, not inside the held list, so the click that ended the hold was eaten
   only when it landed on the list: one landing on the menu (Install is the first item of Browse's row menu) or
   on a sheet the hold opened (Installed, My IPAs) went through.
3. rowswipe.js already ends a swipe on pointercancel/lostpointercapture and eats the drag's click; the scroller's
   grab cancels the click with `preventDefault` on touchend. Left alone.

## The fix

- New `web/app/nav/tapguard.js`: one document-level tracker of the current touch (max distance from pointermove and
  touchmove, any `scroll` on any pane while the finger is down, pointercancel). `guarded(fn)` drops a click that ends
  a gesture that moved > 10 px, scrolled or was cancelled. Clicks with no touch behind them (keyboard, `el.click()`,
  `detail` 0, direct calls) always run.
- `installRows` wraps every row's onClick with `guarded` (app page, Version History via browse.js, the website's
  gate rows). Installed's Delete button (`.del-confirm`) too.
- menu.js: `HOLD_MS` = 550 (was 500); a hold is cancelled by a `scroll` anywhere in the document while the finger
  is down (listener added at pointerdown, removed at the end); after a hold fires, the next click anywhere is eaten
  until a new pointerdown (or 2 s). Menu items need a pointerdown on the menu itself (a new touch) and are guarded.
- installed.test.js's B36 hold test ticks `HOLD_MS` instead of 500.

## Tests

- `web/app/nav/tapguard.test.js`: tap installs; scroll, > 10 px drag, touchmove-only drag, pointercancel don't;
  momentum after the lift doesn't count; keyboard/stale clicks run.
- `web/app/nav/menu-hold.test.js`: hold + drift + lift onto the item doesn't choose it, a new tap does; scroll,
  pointercancel and a move cancel a hold; nothing at 500 ms; the hold's click is eaten on a sheet under the finger.
- `web/app/screens/install-tap.test.js`: the app page's jailbreak Install row ignores a scroll and a 30 px drag,
  installs on a tap.
- `node --test web/app`: 1413 pass, 0 fail.

## iPhone 7 (jailbreak app)

The installed .deb's web files are older than main for altstore.js/installed.js/browse.js/sources.js, but its
`nav/menu.js` was byte-identical to main's, so only `nav/menu.js` + the new `nav/tapguard.js` were swapped in
(backed up, restored afterwards, md5 checked), app closed from the switcher to reload. Screens in
`ref/7/screens/b48-*.png` (gitignored):

- `b48-slow-scroll-row`: a 1.5 s slow drag starting on a source row scrolled the list; nothing opened, no menu.
- `b48-hold-lift`: a 1 s hold then lift on Feather Repository opened Copy URL; the lift didn't choose it and the
  source page didn't open.
- `b48-new-tap`: a fresh tap on Copy URL chose it (the menu closed).
- `b48-tap-opens`: a plain tap on FIZL0 still opens the source.

## Not verified

- **The app page's Install rows on the phone.** The phone's altstore.js is older than main (swapping it in could break
  its imports), and a stray tap there would really install an IPA on the shared test phone. Covered by
  install-tap.test.js only. Checking it needs a .deb built from main with this change.
- **Hold, then drift onto the menu, then lift** on the phone: phonectl's swipe moves linearly from the start, so it
  can't hold still and then move. Covered by menu-hold.test.js.
- **Which exact iOS behaviour sent the user's click** (short drag below the pan threshold vs. a pane at its end with
  no bounce vs. a hold menu): not reproduced with synthetic touches; the guard covers every path above.
- That the clipboard really got the URL after Copy URL (only saw the menu close).
- That the final switcher swipe closed iFizBox (no screenshot after it); if not, it keeps the B48 menu.js in memory
  until its next launch, the disk files are the originals.
