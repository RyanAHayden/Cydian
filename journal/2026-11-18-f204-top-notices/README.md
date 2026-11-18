# F204: top notices stop moving the page

## What changed

- **Banner** (`web/app/nav/banner.js`, `ios6.css .banner`): no more `html.has-banner` / `--banner-h` push; the
  has-banner rules for `#navbar`, `#screens` and `.sheet` (and the `.sheet` translate transition from B25) are gone.
  The banner is `top: var(--nav-h)`, `z-index: 2` (nav bar 3, screens 1), no safe-area top padding, and slides
  out from behind the nav bar (`translateY(-100%)` -> none). With a sheet open, it is appended inside the top
  `.sheet`: the sheet's `will-change: transform` makes it the containing block and stacking context, so the same
  `top`/`z-index` put it under the sheet's own nav bar and over its body (chose this over "stack above the top
  sheet", which would paint over the sheet's nav bar while sliding).
- Timer: 5 s (`AUTO_MS`), 8 s with an action (`ACTION_MS`), or the caller's `duration` when given (the refresh
  failure and import-failure banners pass 6 s; kept). A 2 pt `.banner-timer` line along the bottom scales 1 -> 0;
  that Web Animation *is* the timer (its end hides the banner), so pausing it on `pointerdown` pauses both.
  Release resumes; an upward drag follows the finger and past 16 px dismisses; a tap (move < 8 px) dismisses and
  runs `onTap`.
- `wait: true` = no timer, stays until tapped or the page comes back after the user was away. Added to the two
  "Press Open" / "Press Install" calls in `screens/importlink.js` and `signing-client.js` (one-word edits outside
  the task's file list: without them those banners would have gone after 5 s, against the brief).
  `nav/banner.test.js` checks both calls carry it.
- **Reload bar** (`nav/reloadbar.js`, `ios6.css .reload-bar`): no push. 44 pt strip at `bottom: var(--tab-h)`,
  `z-index: 2` under the tab bar (3), slides up from behind it (`translateY(100%)`), as the undo bar does.
  `html.has-reload` now only adds a 44 pt `::after` block at the end of each scroller (`.page-body, .sheet-scroll,
  .search-results, .progress-scroll, .console-scroll, .filter-drop-inner`), so the last row scrolls clear and the
  scroll position doesn't change. With a sheet open (`body:has(.sheet)`), the strip goes over the sheets
  (`z-index: 26`) and `translate`s down by `tab-h - safe-bottom` to sit just above the home indicator (sheets have
  no tab bar); `translate` transitions, composited.
- Tests: `ios6-css.test.js` (B25/B26 push tests replaced with F204 ones), `nav/reloadbar.test.js` (strip on the tab
  bar, no push, room rule, over-sheet rule), new `nav/banner.test.js`.

## Check

`node --test web/app`: 1166+ pass. 3x render (390x844, safe areas 47/34, headless chromium via
`tools/shots.mjs` + `tools/serve.py`, output in `shots-output.txt`): Changes, a pushed Settings page (list + Back)
and a sheet, each before/after showing a banner (with Upgrade) plus the reload bar. Nav bar, first row, Back and
tab bar boxes are identical before/after; the banner is at y = 91 (47 + 44), the reload strip at 717-761 (on top of
the tab bar) or 766-810 over a sheet; each scroller's scrollHeight grows by exactly 44.

## Tried and dropped

- A regex in banner.test.js that stopped at `}` / `;` missed both Press calls (`${NAME}`, "updating; open"); the
  test now also asserts it found the call, so it can't pass vacuously.

## Not verified

- On a real iPhone (WKWebView, the jailbreak app): touch pause / swipe-up / tap feel and 120 Hz smoothness. The
  render was headless Chromium with emulated touch and insets; the iPhone 7 isn't for this task.
- Changes with real rows: on the website every list tab but Home/Settings is locked and Changes has no data
  without sources, so the list/Back check used Settings > Account instead.
- Opening a sheet while the reload bar shows jumps its z-index to above the sheets at once and slides it down by
  translate; not watched frame by frame.
- The undo bar (F193) uses the same strip above the tab bar; if both show at once they overlap (reload bar later
  in the DOM wins). Not handled; rare (a swipe-to-queue during a refresh).
- The concept artifact (claude.ai link) wasn't opened: it needs a signed-in browser.
