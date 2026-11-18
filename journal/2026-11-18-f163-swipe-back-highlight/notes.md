# F163: swipe back fades the row highlight (2026-11-18)

## What was there
Before this, the app kept no selection at all: a tapped row's `.is-pressed` came off 140 ms after the finger lifted
(app.js `unpress`), partway through the push. Nothing was blue while the page below was revealed. The user's 4S
reference is UIKit's own behaviour: the opened row stays selected on the page below, and
`deselectRowAtIndexPath:animated:` runs with the pop's transitionCoordinator, so the blue fades with the pop and
comes back if the swipe is cancelled. That is what this task adds.

## What I did
- `web/app/nav/selection.js` (new): `selectionOpacity(p)` (p as in nav/transition.js: 1 the opened page in place,
  0 the page below back; opacity = p, clamped). `selectRow(row)` lays a copy of the row over it with the app's
  `.is-pressed` look plus `.sel-ghost` (inert, aria-hidden, no href/ids). Only the copy's opacity changes, so it
  is compositor-only (120 Hz rule). `keepRow`, `rowKey`, `findRow` and `ghostFor` remember the row by its href (or a
  button row's label) and lay a new copy at pop start if the list re-rendered while hidden.
- `nav/transition.js`: `frames()` gets an optional `below.select` part, opacity `selectionOpacity(p)`. So
  setProgress (the finger), animate (Back, the swipe finishing or cancelling) and clear all drive it in step with
  the slide. Without a `select` element nothing changes.
- `app.js`: the press handler records `lastPress`. A push within 1.5 s of a press on a `.cell-inner` of the page
  below keeps that row (`keepSelected`). Pops (Back, tab-root pops, the edge swipe) build their pair with
  `withSelect`. The copy is removed when the pop lands; a cancelled swipe's `clear()` leaves it at full opacity. A
  page that comes back on top with no slide (a web back, a tab switch, a replace) drops its copy at once.
  `lastPress` resets on every touch-down and when a scroll cancels the press. The "one held look" loop skips
  `.sel-ghost` so a new touch doesn't strip the copy.
- `ios6.css`: `.cell-inner.sel-ghost` puts the copy over the row (absolute, inset 0, no pointer events,
  `will-change: opacity`).
- Test: `web/app/nav/selection.test.js`: opacity against progress (with clamping), a swipe sequence that fades and
  then cancels back to 1, commit and Back ending at 0, the fade animation having the same timing as the slide, a
  pair with no selection left alone, the copy's attributes, and finding the row again after a re-render.

## On the iPhone 7
I didn't build a .deb. Under the ui-7 lock I backed up the installed app's `web/` (0.4.0, e7f5896) to
`/tmp/f163-webbak` on the phone, copied this branch's `web/app` over it, restarted the app and tested on
Sources > BigBoss. Screenshots are in `ref/7/screens/f163-*.png`:
- `f163-b-mid1` / `f163-b-mid2`: a slow edge swipe at about 78% and about 59% progress. BigBoss's row is clearly
  blue in the first and paler in the second. `f163-b-after`: back on Sources, no blue.
- `f163-c-cancel`: a short swipe (200 px) cancels and stays on BigBoss. In `f163-c-cancelmid`, the next swipe starts
  with the row fully blue again.
- Then I put the original `web/` back (checked `app.js` against e7f5896) and quit the app (its pid, the process my
  `open` had launched).

What failed along the way:
- The first device try showed no blue. The app was still running the old files: my "is it running" check compared
  the wrong path, so the restart never happened. I found its pid by the executable's real path and killed it.
- Then the blue was still missing. Debug output on screen (phone copy only, never committed) showed the copy was
  detached by the time the swipe began, because Sources re-renders its rows while hidden. Fixed with
  `rowKey`/`ghostFor`, which lay a new copy over the re-rendered row when the pop starts.
- My first tap on Home landed on a GitHub link after the page re-laid out, which opened Safari. Harmless.

## Not verified
- **The Back button's fade on the phone:** the pop takes 350 ms, and a screenshot over ssh lands after it is done
  (`f163-c-backmid` is already back on Sources). It uses the same `animate()` path that the node tests check, and
  the swipe's finishing slide shows that path works on the device.
- **120 Hz:** the iPhone 7 is a 60 Hz panel and I had no frame trace. The change only animates opacity on one extra
  layer per pop.
- **Dark theme, grouped first/last rows (rounded corners), and vlist package rows:** not tried on the device. The
  copy keeps the row's own classes, the grouped list's `overflow: hidden` clips it, and in a vlist row (already
  absolute) its position is left alone.
- **The 4S reference screenshot 77:** the brief says the right shot wasn't found. I didn't look on the 4S; the
  behaviour follows UIKit's documented transitionCoordinator deselect.
- A row opened by F153's native momentum tap gets no blue: that path sends no pointerdown, so `lastPress` is never
  set. That matches the old behaviour (no blue there either). I left it alone.
