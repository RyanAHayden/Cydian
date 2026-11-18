# R17: a quick tap during momentum in iOS Safari (web side)

## Question
F153 fixed it in the app natively, but in iOS Safari a tap that lands while a list coasts still only stops the scroll:
the page gets no event at all. Can anything on the web side catch it, and what would it cost against the 120 Hz rule?

## Answer
**Only one thing works: our own JS momentum.** It also breaks the 120 Hz rule on every fling to fix one rare gesture,
so **I don't recommend it, and I filed no follow-up.** The website keeps the iOS default: a tap during momentum stops
the list. It is also what native UIKit lists (UITableView) do everywhere on iOS.

## How it was measured
iPhone 7, iOS 15.8.8 Safari (UA `Version/15.6.8`), under the `tools/ui-7.sh` lock as R17. The probe page is
`probe.html` here. I served it from the session scratchpad with a small Python server that took POSTed logs, through
`ssh -R 8717:127.0.0.1:8717 7`, so the phone opened `http://127.0.0.1:8717/`. The page has a 400-row list in a fixed
`overflow-y: auto` box, like `.page-body`, and a capturing listener for every `on*` event type on window and
document plus touch, gesture and mouse events. It also logs `scrollTop` on every rAF while scrolling. Each trial
was one ssh command, `phonectl swipe 375 1100 375 500 0.08; sleep 0.15; phonectl tap 375 800`, so the tap
landed about 0.2 s into the coast. The server, the tunnel and the UI lock were all released afterwards, and the
phone was left on the home screen.

| Variant (`?m=`) | What it is | Tap during coast reaches the page? |
| --- | --- | --- |
| native | plain overflow box | **no event at all.** The list stops dead, e.g. at 701 px while moving ~33 px/frame (F153's finding confirmed) |
| ta | rows `touch-action: pan-y` | no event |
| tm | rows `touch-action: manipulation` | no event |
| doc | the document scrolls instead of a box | no event |
| js | at touchend, `overflow-y: hidden` (stops UIKit's deceleration) and a rAF loop drives `scrollTop` (UIKit's 0.998/ms decay); overflow is restored on the next touchstart | **yes:** pointerdown, touchstart, pointerup, touchend. No native click, but F153's JS path in `momentum-tap.js` (`mt=1`) clicked the row: `click 9 (ours)` |
| js2 | the same, but overflow is hidden for one frame only, so the box stays natively scrollable while JS coasts | **yes:** the same events, `click 9 (ours)` with `mt=1` |

A drag during the JS coast (both `js` and `js2`) was a normal native pan (pointercancel, the list moved), and a new
JS glide started when it ended. So the mechanism itself works. `momentum-tap.js` needs no change: its touch path
already treats our rAF `scrollTop` writes as coasting (scroll events with no finger down).

## The cost (`coast-frames.txt`: 3 flicks per row, no tap, scrollTop read on each rAF)
| Variant | Frames moving | Median frame | >20 ms frames | Distance | First deltas (px/frame) |
| --- | --- | --- | --- | --- | --- |
| native | ~170 | 17 ms | 7–10 | 1670–1790 px | 75, 75, 52, 50, 49, 47 (smooth) |
| js2 | ~112 | 17 ms | 2–3 | 1090–1260 px | **75, 0, 75, 19, 52, 20, 36, 35** |
| native + load | ~170 | 17 ms | 1–4 | 1550–1650 px | 75, 0, 107, 49, 46 |
| js2 + load | ~114 | 17 ms | 1–2 | 1190–1280 px | **75, 0, 75, 2, 28, 37, 38** |

(`load` rewrites the text of 12 visible rows on each scroll event, a rough stand-in for vlist.) The native rows read
the main thread's view of `scrollTop`, which lags the UI process's compositor scroll, so their ">20 ms" and stall
counts say nothing about what was on screen. Native momentum runs off the main thread and never drops for page work.

What a JS coast costs:
1. **120 Hz:** by default, iOS Safari runs rAF at about 60 fps even on ProMotion phones (WebKit's "Prefer Page
   Rendering Updates near 60fps", on by default). A JS-driven coast would update at 60 Hz where native momentum
   runs at 120 Hz on the compositor, so every fling on every list would be half-rate. That breaks the AGENTS.md rule
   outright. Every coasting frame also needs the main thread and a layer-tree commit, so vlist rendering and the
   Web Worker's messages compete with the scroll itself.
2. **A hitch at release, measured:** UIKit starts its own deceleration before the page's touchend arrives. The
   first frames go 75, 0, 75, then 19–52 px, alternating, before settling. One frame stalls, and the velocity
   jumps down by about a third. The touchmove-sampled velocity came out ~30% low, so the glide went ~1.2k px against
   native's ~1.7k. Sampling scroll events instead could narrow the gap, but the hand-off (native's first momentum
   frame, then our takeover) can't be fixed from the page.
3. **Feel:** it loses UIKit's exact deceleration curve and the native rubber band at the ends (scroller.js's
   transform `bounce()` is an approximation), on every list on the site.

Weighed against a gesture that only fails when someone taps during the ~1 s a list coasts, it isn't worth it.

## Newer iOS (17/18/26)
The tap is spent by UIKit's UIScrollView. A touch-down on a decelerating scroll view stops it and isn't delivered
to its content, which is the same in native apps. WKWebView's child scroll views are UIScrollViews, so I don't expect
a newer iOS to behave differently. I could not test it (below).

## Tried and dropped
- Telling the tap apart afterwards (the coast stops dead while still fast): you can see that the coast stopped,
  but there are no coordinates, so nothing knows what to click. Not worth building.

## Not verified
- **A newer iOS (17, 18, 26) and a ProMotion (120 Hz) iPhone:** the only test phone is the iPhone 7 (iOS 15.8.8,
  60 Hz). The 60 fps rAF cap in Safari is from WebKit's default setting, not measured here. The "no event on newer
  iOS" expectation comes from UIKit's standard behaviour, not from a device.
- **The real site's lists:** the probe was a plain 400-row list, not Cydian's vlist pages. The real pages do more
  per frame, which would only make a JS coast cost more.
- **The website at cydian.dev itself:** not opened. The probe isolates the browser behaviour, and the site has the
  same overflow boxes.
