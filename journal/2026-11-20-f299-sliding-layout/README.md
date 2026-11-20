# F299 Sliding layout everywhere

## What I did

- `web/app/nav/slide.js`: one shared FLIP helper that applies itself to every screen, so no screen had to change.
  `installSlides()` puts one MutationObserver on `document.body` (childList, characterData, `hidden`) and one
  ResizeObserver on the measured boxes. Slide roots: `.page-body`, `.sheet-body`, `.sheet-scroll`, `.search-results`,
  `.alert-scrim` (so alerts that grow are covered too). After every change in a root it measures the block boxes again
  (offsetTop chains, which ignore transforms, so a running slide doesn't throw the measure off) and compares them
  with the last measure:
  - moved box: `translateY(old − new)` → none, .3s `cubic-bezier(.25,.1,.25,1)` (`.preview-slot`'s timing);
  - nested boxes move by the difference from their moving parent, so the animations add up to the right place;
  - a box interrupted mid-slide starts from where it shows now (the curve is solved in JS: `bezier()`);
  - new box: fades in; gone box: a copy fades out where it showed. Its old ancestors go along as
    `display: contents` shallow copies, so selectors like `.table.grouped > .cell` still style it;
  - a whole-page redraw (`el.replaceChildren(page)`, which is what Installation & Signing and most screens do) is
    matched by structure: same tag + first class among siblings, same text first, then position between anchors.
    An identical redraw animates nothing (checked in Chromium).
  - Not slid: `.vlist` (recycled rows), `.progress-body` (the install console), absolute/fixed/sticky, inline
    boxes, boxes animated by someone else (CSS transitions, a screen's own fade, `.preview-slot` keeps its own height
    transition), boxes with a transform of their own, `data-noslide`, pages over 600 boxes, reduced motion, a covered
    page, a width change (rotation). Off-screen boxes (more than a screen away) aren't animated.
- Installed from `nav/scroller.js` `initScroller` (one line), so app.js isn't touched (it's outside the task's files).
- `nav/ui.js` `collapse(li)`: on a watched page it just removes the row and leaves the slide (and the fade) to the
  watcher; otherwise its old FLIP. Two FLIPs on the same rows would have shifted nested rows twice.
- `style.css`: `overflow-anchor: none` on the roots, so Chromium's scroll anchoring doesn't fight the slide (iOS
  WebKit has no scroll anchoring, so this changes nothing on phones).
- `docs/native.md` Feel: every size change slides through this helper.
- Tests: `nav/slide.test.js` (curve, pairing, plan with nested/entering/leaving/redrawn trees, measure's skips).

## Checked in headless Chromium (capture.mjs, steps.json, smoke.json here)

Served `web/app` on 127.0.0.1 and drove Settings:
- a footer line prepended: every box under it got `translateY(-26px)` → none, the new line faded in;
- removed again: one ghost copy at its old place, the boxes under it slid;
- a footer that wraps from 1 to 2 lines (38 → 76 px): the box under it slid −38 px;
- a row inserted mid-group ("Checking…"): it faded in, the groups under it slid −44 px (screenshot taken mid-slide);
- identical whole-page redraw: 0 animations, 0 ghosts;
- 20 back-to-back text changes: about 3 ms each including the timer hop (desktop);
- Sources, Changes, Search, Installed, Settings > Signing, Home: no page errors, no ghost left behind.

## Brief items

- Installation & Signing while it checks, Ready to Install card, Checking… rows, spinner lines: covered by the watcher
  (it redraws with replaceChildren; structural matching handles it). Not driven through its real loading states.
- Pull-to-refresh: nothing changes size there today (it springs straight back, no spinner area); the reload bar and
  banners no longer push the page (F204), so nothing to slide. In-page update/failed-source notices are covered.
- Lists filling in: placeholders fade out, rows fade in, what's below slides. Virtualised lists (BigBoss, long Search
  results) are excluded on purpose: their rows are recycled per scroll.
- Install queue rows arriving/leaving, rows wrapping, alerts growing: covered by the generic watcher.

## Not verified

- No phone run (iPhone 7 / iOS 15 WKWebView): the task didn't call for the phone, and other slots overwrite the
  .deb (memory). 120 Hz on a ProMotion phone, and iOS 15's Web Animations/ResizeObserver behaviour, are untested.
- Installation & Signing's real loading sequence (Tailscale, signer checks) and the install queue's real progress
  rows were not driven; only synthetic DOM changes on Settings. They go through the same code path.
- Alerts that grow: no alert in the app changes size today that I could trigger; the `.alert-scrim` root is wired
  but not exercised.
- Scroll position: description's "Less" adjusts scrollTop right after the change, which can make that one slide
  look off; not checked.
