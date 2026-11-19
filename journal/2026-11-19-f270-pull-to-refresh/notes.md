# F270 Pull to refresh on Sources, Changes and Home

## What it does

- `web/app/nav/pullrefresh.js`: `pullToRefresh(scroller, { onRefresh, busy, settings })`. An area (`.pull-refresh`,
  480pt tall so a long pull still shows its colour, its 60pt foot holding the arrow, bold "Pull down to
  refresh..." and "Last Updated: …") in a clip box (`.pull-clip`) placed right after the scroller, over it, from
  where its content starts (offsetTop + padding-top) to its bottom. The area moves by transform so its foot is
  always on the content's top edge (`translateY(pull − 480)`), so it covers exactly the gap the pull opens.
  At 60pt of pull (`TRIGGER`) it arms: `.armed` turns the arrow 180° (transition on transform) and the text reads
  "Release to refresh...". Lifting there calls the page's own refresh; lifting earlier runs nothing. A pull that
  starts while a refresh runs (Sources' count `ifizboxRefreshing`, the reload bar's `html.has-reload`, or the
  page's own `busy`) shows nothing and never arms; one that starts before but where a refresh starts mid-pull
  doesn't run either. No spinner at the top: the list springs straight back.
- Two ways a pull happens:
  - iOS rubber-bands the scroller itself (scrollTop < 0): a passive `scroll` listener reads `-scrollTop`, nothing is
    moved by script. iOS WebKit is recognised by `CSS.supports("-webkit-touch-callout: none")`, and any browser
    seen going below 0 is treated the same from then on.
  - Chromium/Android keep scrollTop at 0: after 10px of finger travel down at the top, the scroller's children
    move by `transform: translateY()` (UIScrollView's rubber formula, rounded to whole device pixels: a fractional
    offset left a smeared line of row text in Chromium), `overflow-y: hidden` while held so the browser pans
    nothing, then a 340 ms Web Animation back to none.
  Every listener is passive; per frame only transform changes (the class toggles `on`/`armed` happen at state
  changes; computed style is read once per touch-down at the top, never per frame).
- The pure parts are exported for the test: `pullState`, `pullTracker` (start/move/end/cancel), `rubber`,
  `lastUpdatedText`.
- Last Updated: `settings.lastRefresh` (core/settings.js, `ifizbox.lastRefresh`, ms). Set when the
  `ifizbox:refreshing` count falls back to 0 (Sources' Refresh, Home's Reload, the launch refresh, a retry) and
  by Changes' Refresh (it refreshes without that count). Format: "Today 3:14 PM", "Yesterday 9:05 AM",
  "Nov 3 3:14 PM", another year "Jan 2, 2025", none yet "Never".
- Wiring: Sources (the pinned `.search-results`, re-attached on every `draw()`; idempotent per scroller),
  Changes (`state.results`), Home's root (the `.page-body`; it clicks the nav Reload button, kept through the nav
  spec's `ref`, so it is exactly the button: spinner, web files reload on the website, and a disabled button
  while it spins = busy).

## Tried and dropped

- First version put the area inside the scroller, above the content (absolute, negative top), to come into view
  with the rubber band by itself. Fine in Chromium (script mode moves it with the rows), but on the iPhone 7 the
  rubber band showed a blank white gap: WebKit doesn't paint a scroller's content above its scroll origin. The
  refresh still ran on release (scrollTop < 0 was read fine). Hence the clip box beside the scroller.

## Decisions

- **Colours.** The 4S's Twitter (screenshots in `ref/4s/screens/f270-pull1.png` / `-pull2.png`, not committed)
  draws the arrow and text on the page's own grey and has no Last Updated line. The brief asked for the
  classic blue-grey area with Last Updated, so: area `#e2e7ed` (the classic Tweetie colour, nothing on the 4S to
  sample), arrow and text from the 4S: arrow redrawn as SVG from its pixels (12pt shaft of 4pt bars with 2pt
  gaps, a 21×13pt head, `#9b9b9b` fading towards the tail, 42pt in all, at x 33–55), text bold 14px `#777`
  with a 1pt white emboss at x 80, as Twitter places it. Dark theme: palette tokens only (theme-palette.test.js): `--dk-field` area,
  `--dk-index` text.
- **Changes' refresh shows the "Reloading Data" HUD, not the reload bar**, because that is what its nav
  Refresh does (F250 `reloadSources`) and the brief says "exactly as its nav button does". Not changed here.
- Home on the website: its Reload re-downloads the site's files and reloads the page (home.js refreshWebFiles), so a pull there
  reloads the page, as the button does.
- A cancelled Sources refresh also brings the count to 0, so it updates Last Updated too (the module can't tell a
  cancel from an end without touching the refresh code). Small, written down.

## Getting the 4S art

The 4S was on its lock screen and `stouch swipe` on the slider didn't unlock it; `activator send
libactivator.lockscreen.dismiss` did, with Twitter already open. A held pull: `ssh 4s 'stouch swipe 160 150 160 330 8'`
in the background and `tools/ui-4s.sh F270 shot …` 6 s in (a slow 8 s swipe is still held when the shot lands);
to 440 for the Release state.

## Checks

- `web/app/nav/pullrefresh.test.js`: arm/release thresholds, back-under-the-trigger, busy at start / at end /
  both, cancel, rubber damping, Last Updated formats, settings.lastRefresh storage, the three screens' wiring,
  passive listeners and transform-only transitions.
- Headless Chromium (375×667 @2x, touch emulation, CDP `Input.dispatchTouchEvent`, a scratch script) against
  `python3 -m http.server` on web/app:
  - Sources, 220px drag: area shows, armed, "Release to refresh...", "Last Updated: Today 5:40 PM"; on release
    the reload bar came up ("Downloading Packages") and the list sprang back (transforms cleared).
  - Sources, 90px drag: "Pull down to refresh...", not armed; release: no reload bar, Last Updated unchanged.
  - Sources with a refresh running (nav Refresh tapped first): the pull shows nothing, nothing moves.
  - Changes, 220px: armed, release ran its Refresh (lastRefresh set).
  - Home (website), 220px: armed; release ran Reload (the page reloaded, as the button does on the site).
  - Sources, three pulls in a row with a wait between: each armed and ran Refresh.
- iPhone 7 (the .deb of this branch, 0.9.9-1957, installed with `apt-get install` under the ui-7 lock; slow
  `phonectl swipe` with a screenshot taken mid-pull):
  - Sources: area, arrow and text show in the rubber band ("Pull down…" while short, "Release to refresh…" with
    the arrow turned over past the trigger); release runs Refresh under the reload bar ("Refreshing 18 of 26…",
    "Downloading Packages", Cancel). Arrow and text zoomed in: clean, same as the 4S's.
  - Changes: armed, release ran its Refresh ("Reloading Data" HUD).
  - Home: armed, release ran Reload (the button's spinner, "Updating Sources" under the reload bar).
  - A debug copy of pullrefresh.js (an on-screen log, swapped in by hand and swapped back, md5 checked) showed
    start → touchend (armed, ran) → runNow on three pulls in a row.
  - Found on the phone and fixed: a refresh started at the lift, while iOS's own spring was still running, put
    Sources' strip up mid-spring and left the list scrolled down by the strip's height. The refresh now starts once
    the scroller is back at 0 (a scroll event at or above 0, or 900 ms at most).
  - Two armed pulls earlier in the session ran nothing; both came a few seconds after a refresh had just finished
    (likely Sources' `state.busy` still set by the refresh's tail or B75's follow-up load, which counts as "a
    refresh runs"). Not reproduced afterwards, with or without a screenshot taken mid-pull.

## Not verified

- 120 Hz: no frame timing taken; the iPhone 7 is 60 Hz and the 4S must never run iFizBox. What holds it: only
  `transform` changes per frame, all listeners passive, layout read once per touch-down at the top.
- The dark theme's pull area: drawn with palette tokens, not looked at on a screen.
- A fling's overshoot at the top (no finger): shows the area under it; not checked on the phone (phonectl swipes
  are drags).
- Script-mode pull (Chromium's way) on a real Android phone: only headless Chromium with touch emulation.
- Why the two early armed pulls on the phone did nothing (see above): a likely cause, but not proven.
