# B125: white strip over the last rows on pages with the pinned search bar

## Cause
Every page with the shared search bar (nav/searchbar.js `pinned()`: Sources, Search, Changes, Installed, My IPAs)
turns its `.page-body` into a flex column (`.search-root`) whose `.search-results` child is the scroller. The page
body kept its normal bottom padding (`calc(var(--tab-h) + 20px)`, style.css), so the scroller ended a tab bar + 20px
above the screen bottom, i.e. 20px above the tab bar. Rows clipped there and the body's opaque background showed as
a 20pt strip above the tab bar. While the reload strip or Manage's toolbar showed, the page body's `::after`
(44px end room) became another flex item and the strip grew to 64pt.

Measured in Chromium (390x844, safe areas 47/34), scrolled to the bottom, before the fix: scroller bottom 741, tab
bar top 761, the point 5px above the tab bar was the page body. With `has-reload`: scroller bottom 697.

## Fix (shared CSS, all pinned pages at once)
- packages.css: the pinned page body has `padding-bottom: 0` and `::after { display: none }`; `.search-results` takes
  the `calc(var(--tab-h) + 20px)` padding, and Manage's 44px toolbar room (`html.has-manage-toolbar
  .search-results::after`); the reload room was already on `.search-results::after` (ios6.css).
- nav/scroller.js: the iOS 6 indicator for an own-box scroller now stops at the tab bar's top when the scroller runs
  under it (otherwise its track would have run behind the tab bar).
- Test: web/app/search-root-css.test.js.

## Checked
Headless Chromium over CDP (script kept in the session scratchpad, not committed), list padded with 30 cloned rows
plus a marked last row, scrolled to the bottom:
- 390x844 (safe 47/34) and 402x874 (safe 62/34), web and with a fake native bridge (`ifizboxApp`/`ifizboxNative`),
  light and dark (Theme Mode set to dark): Sources and Search scroller bottom = screen bottom, last row ends 20px
  above the tab bar (the page's usual end room), the point above the tab bar is the scroller, not the body.
- Changes (pinned) same; Sources with `has-reload`: last row ends 65px above the tab bar (clear of the 44px strip).
- 3x zoomed shots of the bottom edge (light web, dark native): the row runs to the tab bar's edge, no strip, and
  the indicator stops at the bar.

Failed attempt: my first baseline server port (8732) was already taken by another session's server, so the first
"before" run measured someone else's page; I re-ran on a free port.

## Not verified
- On a real iPhone on iOS 26 (the user's phone): no device run in this task; WebKit's padding-at-the-end-of-a-
  scroller behaviour is the same one every `.page-body` already relies on.
- My IPAs and Installed with a real installed list (web Installed had no apps, so no search bar showed): they use
  the same `pinned()` layout, covered by the shared rule.
- Manage's toolbar room on a pinned page in a browser (only checked by the CSS test).
