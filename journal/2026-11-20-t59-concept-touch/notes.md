# T59: concept tool follow-ups (mouse as a finger, ResizeObserver error)

T57's concept tool wasn't on main when this started; it was being merged. I waited for it, building against a
read-only scratch worktree of its commit (9b0a26db) in the meantime, then fast-forwarded task/T59 onto main once
it landed (same files byte for byte) and copied the changes over.

## (1) Clicks behave like touch: `tools/concept/touch.js`

A classic script that build.py appends to shell.js, so it runs in the phone's iframe before the app. It does in the
page what Chromium's device mode does with touch emulation on:

- Real mouse events (`isTrusted`, pointerType mouse) are stopped at `window` in the capture phase; the app never
  sees them. Instead: `pointerover/enter/down` (pointerType `touch`, pointerId 2) + `touchstart` on press,
  `pointermove` + `touchmove` while down, `pointerup/out/leave` + `touchend` on release, then for a tap the
  compatibility `mouseover/move/down/up` (skipped when pointerdown was prevented) and a `click` (a PointerEvent with
  pointerType touch, detail 1, so nav/tapguard.js treats it as a real tap). Touch has implicit capture: every event
  goes to the press target, or to the element that called `setPointerCapture(2)` (patched, since the browser only
  knows the mouse's pointer and would throw).
- Panning: past 10 px, in the axis the computed `touch-action` chain allows, the pointer gets `pointercancel` (as a
  browser does when it takes a touch for a scroll), :active goes off, and the nearest scroller that way follows the
  finger. Release: momentum (UIScrollView's 0.998/ms deceleration), a bounce when it hits an end with speed, and a
  rubber band past the ends while dragging (UIKit's formula, drawn as `composite: "add"` transform animations on the
  scroller's children so they never fight the app's own transforms). A prevented touchstart/early touchmove keeps
  the drag for the app; a scroller the app sets to `overflow: hidden` mid-drag (pull to refresh's script path, the
  scroll indicator's grab) is handed over.
- `:active` -> `.concept-active` (set on the element and its ancestors while down, off on pan/up), `:hover` ->
  `:not(*)`, `(hover)`/`(pointer)` media queries -> phone answers: build.py `touch_css()` for the stylesheets,
  touch.js's `matchMedia` wrapper for script. The cursor is a grey touch dot (darker while pressed) on every
  element. Fields (`input, textarea, select, contenteditable`) keep the native mousedown, so focus, caret and the
  select picker still work. The wheel scrolls natively.

Checked by hand (scratch copy of check.mjs, not kept) on #/sources, iPhone 15/16, jailbroken: a left drag on a
source row arms its Delete (nav/rowswipe-style code in screens/sources.js), a tap elsewhere puts it away, a 900 ms
hold shows the black Copy URL menu (nav/menu.js longPress). The first try said long press failed: my script had
tapped the Delete button first, which deleted the row; not the emulation.

## (2) "ResizeObserver loop completed with undelivered notifications"

Reproduced with check.mjs once it changed the device live: the error came from the phone. Instrumenting
ResizeObserver (scratch shell prefix) showed it is the app's own `nav/slide.js` observer: its callback calls
update(root), which observes newly measured boxes inside the callback (entries DIV.home, SPAN.cell-text, then
P.home-version in a second broadcast). That's app code outside this task's files, so:

- frame.html: a device change now loads a fresh app at the new size (same page, same storage) instead of resizing
  the running one, and `load()` swaps in a new iframe element each time, so the old app is detached in the same
  task and never draws a frame at the changed size (also covers the mode switch, which resized the old iframe for
  the Safari bar just before replacing its srcdoc). Cost: an open sheet or scroll position doesn't survive a device
  change (SKILL.md says so).
- Filed B213 (low) for slide.js itself (real iPad rotation / Split View would hit the same).
- check.mjs fails on it: a new-document script records window `error` events in the page and every frame (this one
  reaches no console), and each run changes the device and back with the app running. Before the frame.html fix the
  check failed with `phone: ResizeObserver loop completed with undelivered notifications.` at both devices.

## check.mjs

Each device x theme run now also opens `--drag-route` (default `#/home/credits`: Settings only scrolled 1 px on the
17 Pro Max) and, all by CDP mouse events: presses a row (is-pressed and .concept-active on, the app saw
`pointerdown:touch` and `touchstart`), drags it up fast (list follows, keeps gliding after release, press let go,
pointercancel and no click, page unchanged), pulls past the top (rubber band 5-120 px, back to 0), drags from the
left edge (went back). Then the live device change and back.

Results (`node tools/concept/check.mjs PAGE --modes …`, iPhone SE + 17 Pro Max, light Classic + dark Gunmetal):
jailbreak, sideload and site all clean (202 checks in the first full run; its only failures were the edge swipe in
Website mode, where app.js leaves the back swipe to Safari and turns the strip off, so the check now expects it only
where the strip is on; the re-run of site + jailbreak was all clean, 138 checks).

## (3) Eras

No era exists yet (F201-F203 blocked behind C44), so there's nothing to read. Split off as T59a, `--after F201`.

## Not verified

- The published Artifact viewer itself: everything was checked in headless Chromium under check.mjs's copy of the
  Artifact CSP, not in claude.ai's frame. Nothing was published (the task asked for no new concept).
- Safari / WebKit as the viewer's browser (no WebKit here): desktop Safari has no `Touch` / `TouchEvent`
  constructors, so touch.js sends pointer events only there (press, long press, swipes, taps still work; the scroll
  indicator grab and pull to refresh listen to touch events and won't). Not run in Safari.
- Pull to refresh by mouse on a page that has it: the hand-over path (overflow hidden) is written but no check
  drags a pull-to-refresh list.
- Switches, sliders and the section index by mouse drag: not driven.
- Eras: T59a.
