# B126: Sources' section header hangs over the first row while the refresh strip shows

## Cause
packages.css had `.page-body:has(> .refresh-strip:not([hidden])) .section-header { top: 24px; }`, written for F233
when the page body was the scroller and the strip stuck inside it. Since C10, Sources uses the pinned layout
(nav/searchbar.js `pinned(el, strip, bar)`): the strip and the search bar sit above `.search-results`, the list's own
scroller. Sticky offsets count from that scroller's top, so the extra 24px put "Individual Sources" 24px under the
search bar, over the first row (the user's iOS 26 screenshot).

## Fix
The list is already its own scroller, so `top: 0` is right. The strip's offset rule now applies only to a page body
that is not `.search-root` (a strip that scrolls in the same box as the headers). No page has that today, but the
rule stays for a strip placed in a plain page body. Test: web/app/sticky-header-css.test.js (every rule that moves a
`.section-header`'s top leaves `.search-root` out; header and `.vlist-sticky` stick at 0; Sources pins its strip).

## Checked
Headless Chromium over CDP, 390x844 @2x, iPhone UA (script kept in the session scratchpad, not committed). The
Sources list was padded with 25 cloned rows so it could scroll. Strip shown and hidden by toggling `.refresh-strip`'s
`hidden`, the same way paintStrip does:
- Web, light: strip at 44-68, bar at 68-112, scroller top 112. Scrolled 200 px, the header sits at 112-135 (flush
  under the bar). With the strip hidden: bar at 44-88, header at 88-111. With the old rule put back, the header was at
  136-159, over the first row (reproduces the screenshot).
- Web, dark (data-theme=dark plus prefers-color-scheme dark) and native shell (fake `ifizboxNative`, dark): same
  numbers. Screenshots looked right.
- Strip sliding in and out: the strip shows and hides at once (`hidden`) and does not animate. Because the header is
  sticky to the scroller, it moves with the scroller's top in both states (checked both states, scrolled and not).

Decision: the header keeps the kit's 90% translucent category gradient (ios6.css `--category`; the dark palettes use
94%). UITableView's plain section headers on iOS 6 are see-through, so a row scrolling under one shows faintly. That
is the iOS 6 look (AGENTS.md: iOS 6 is the base style). What the screenshot showed was the header sitting over a whole
row in the wrong place. That is fixed: the header now only covers rows that have scrolled up under the bar.

## Not verified
- On a real iPhone (iOS 26): no device run. The fix only removes a CSS offset, and WebKit's sticky-to-scroller
  behaviour is the same one every other pinned page already relies on.
- Search, Changes, Installed and package lists with real rows: in this headless setup they had no rows (empty fake
  bridge, no query, web Installed empty), so no section headers showed. Their headers never matched the changed rule
  (only Sources has a refresh strip), and the test checks that every offset rule leaves out the pinned layout.
- 402x874 / other sizes and the iOS 15 shell: not run. Nothing in the change depends on the size.
