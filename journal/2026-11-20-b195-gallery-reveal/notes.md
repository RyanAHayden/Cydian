# B195: the screenshots gallery opens without the rows sitting on it

## What was wrong
The user's recording (frames 0.9-1.4 s at 15 fps) shows two things:

1. **Gallery overlap.** `previewSlot` (screens/altstore.js) swaps the 44px loading strip for the full-height gallery
   in one step, and nav/slide.js slides the rows below from their old place (translateY up). For the whole .3s the
   gallery is drawn at full height under the rows (Rating / Works On / Size tiles, Description), so the photos show
   through and around them while they slide down.
2. **Skeleton during the push.** The page opens with `placeholder("page")`; its content arrives while the push is
   still sliding, and slide.js fades a copy of the skeleton out over the content fading in. The result is a
   half-faded skeleton layer laid over the page.

## What changed
- `revealSlot(slot, by)` (screens/altstore.js), called from `resizeSlot` when the slot grows and slide.js watches
  it: the slot gets `overflow: hidden`, its box slides from `-by` to 0 and its content from `+by` to 0 with the same
  timing as slide.js (`DURATION`/`EASE` from nav/motion.js, started in the same frame). The content stays where it
  is and only the clip's bottom edge moves, matching the rows below exactly, so the gallery opens downward. Only
  transform animates; the clip is removed when the reveal ends. `hidden` rather than `clip` because iOS 15's
  WebKit (the iPhone 7) doesn't support `overflow: clip`. The slot is already a flow-root, so the clip causes no
  reflow.
- nav/slide.js `fadesOf()`: a leaving `.ph` skeleton gets no fading copy, and a root inside `.page.is-moving` (the
  push, app.js) fades nothing: its content comes in at once while the page slides.
- AltStore app pages (`renderApp`) and package pages (browse.js) both draw their gallery with `previewSlot`, so
  one fix covers both paths. depiction.js has no gallery of its own and is unchanged.
- tools/smoke: step 5 builds a real `previewSlot` above a group of rows on the top page and samples every rAF
  frame. It fails if the gallery's visible bottom (its pictures, limited by the slot's clip) passes the rows' top,
  or if the rows drift from the gallery's edge. Step 6 swaps a skeleton for content at rest and with `is-moving`
  set, and fails on a skeleton copy or a fade mid-push. With `--shots` the gallery runs at 1/10 speed (CDP
  `Animation.setPlaybackRate`) and is shot every 150 ms.

## Results
- Smoke with the fix: 0 of 151 frames overlap (0 of 1501 at 1/10 speed), the rows track the edge to 0.0px, and the
  skeleton checks pass.
- The same smoke run on main's web/app: 17 of 151 frames overlap (worst 358px), and both skeleton checks fail. So the
  test catches the bug.
- Screenshots at 1/10 speed confirm it: on main the red test picture shows below and between the rows. With the
  fix the picture is cut cleanly at the rows' top edge and opens downward with them.
- node tests: `fadesOf` (slide.test.js) and `revealSlot` (altstore-gallery.test.js).

## Tried / notes
- The first version of the smoke fixture inserted the rows and the gallery together. Under slow motion the
  fixture's own rows faded in on top of the Settings group (an entering box fades in at its final place while
  older boxes slide), which muddled the shots. The fixture now waits for the page to settle before the pictures
  arrive, the way an app page opens with its loading strip.
- The smoke's edge-swipe-back step failed 2 times out of about 6 runs while other slots were busy, and passed
  alone. It's unrelated to this change (the same failure appears with or without it); filed as a follow-up.

## Not verified
- On a real phone (iPhone 15 Pro sideload / iPhone 7 jailbreak) at 120 Hz: not run. The check was Chromium at
  60 fps (rAF sampling plus slowed screenshots). WebKit composites `overflow: hidden` plus transform the same way,
  but nobody has watched it on a device.
- The real YouMod page opened from Changes: not driven, because Chromium's fake bridge has no AltStore source with
  that app. The smoke uses the same `previewSlot` code with a test picture.
- The push-skeleton fix was checked by marking the top page `is-moving` by hand in the smoke, not during a real
  push that loads an app page.
