# B191: no layout-property transitions (120 Hz: transform/opacity only)

## What changed

- **Gallery slot** (`altstore.css` `.preview-slot`, `screens/altstore.js` `resizeSlot`): the height transition and its
  `overflow: hidden` / `endResize` code are gone. The slot takes its new height at once, inside `slideChange` (nav/slide.js),
  so the watcher measures before and after and slides the page below from its old place with a translateY (same .3s
  curve). The gallery still fades in. `resizeSlot` still returns whether the height changed (`grows` in the tests).
- **Source-style rows** (`sources.css`, used by Sources, Manage, Installed apps, Wish List, My IPAs, Find More): the
  content's `width` no longer transitions; it snaps, and the `transform` slide stays. So that nothing on the right jumps:
  - edit mode / Manage (`.editing`, `.managing`): `.cell-detail` / `.cell-count` keep their full-width place in the
    narrowed content (`margin-left: 37px; margin-right: -37px`) and get `transform: translateX(-37px)`, transitioned
    with the content's +37px on the same .3s ease-in-out, so they hold still on screen while the name loses 37px. The
    faded chevron gets an untransitioned `translate: 37px` (it rides along with the row as it fades instead of jumping).
  - Delete (`.armed`): the right side fades where it was: untransitioned `translate: 76px` (113 for the chevron in edit
    mode, 120 for Manage's rows, manage.css's 76 + 44) puts it back by the width the content lost, in the same frame.
  - Wish List rows (packages.css `.wish-row`): same for their `::after` chevron and `.pkg-version` (padding 37 in,
    margin -37 out, so the name loses the room and the version keeps its place).
- **Signed Apps rows** (`signsheet.css`): width snaps, the date fades where it was (`translate: 76px`).
- **My IPAs** (`myipas.css`): the chevron's `margin-left` (the price button's room) snaps; the chevron never moved with
  it, only the name's ellipsis did.
- **Scroll indicator** (`ios6.css`, outside the brief's file list, found by the new test): `width .1s` on grab became
  `scale: 1.4 1` (5px -> 7px about the same centre, the old width 7 / right 1), transitioned. `scale` is separate from the
  `transform` nav/scroller.js writes.
- **Test** (`ios6-css.test.js`, "B191: ..."): reads every `web/app/*.css`, parses each `transition` /
  `transition-property` (commas inside `cubic-bezier()` kept, a missing property counts as `all`) and fails on any
  layout property. Run against HEAD's stylesheets it lists exactly altstore height, ios6 width, myipas margin-left,
  signsheet width, sources width.

## Screenshots (3x, headless Chromium, 402pt wide)

A scratch harness built the rows from ios6/sources/packages/manage/myipas/signsheet CSS (before = HEAD's copies, after =
the worktree) and froze every animation at t ms (`document.getAnimations()`, pause, currentTime):

- End states (rest, editing, armed, editing+armed, managing): **pixel-identical** before/after (PIL diff bbox None).
- Mid-transition (`shots/cmp-edit-in-100.png`, `shots/cmp-arm-in-100.png`, before left, after right): counts, dates,
  versions, price buttons hold the same place; the one visible difference is that the name ellipsizes at its final width
  from the first frame instead of narrowing in step (re-ellipsizing per frame is the layout work the rule forbids).
- Gallery (`shots/gal-cmp.png`, top old, bottom new, t = 0/100/200/300 ms): the boxes below move the same distance on
  the same curve; the old slot clipped the gallery while it grew, now the boxes below pass over its lower part as they
  slide down (they paint above it while transformed).

## Tried

- A CSS-only counter-transition on the right items with the width still snapping: impossible, the counter would have to
  start at ±37 and end at 0 in both directions, which a transition between two resting values can't do. Hence the
  margin trick, which keeps their layout place identical in both states.
- First gallery shots showed no slide: my freeze ran before slide.js's ResizeObserver pass, which restarts its slides
  (the paused ones aren't "running"). Freezing again two frames later fixed the shots; nothing wrong in the app.

## Not verified

- Not checked on the iPhone 7 (no task permission to drive it; Chromium only). 120 Hz smoothness itself is not measured.
- The gallery check used a stand-in page (slide.js + altstore.css + a 300px box), not the real app page with real
  screenshots, because the app page needs the backend; the slot code path (`slideChange` around the change) is the same.
- Wish List rows, Find More rows and Installed's edit mode were not shot (pooled vlist rows / screens needing data); the
  rules follow the same arithmetic as the shot rows.
- A long Wish List version string ellipsizes up to 37px earlier in edit mode (its `max-width: 45%` is border-box and now
  includes the 37px padding).
