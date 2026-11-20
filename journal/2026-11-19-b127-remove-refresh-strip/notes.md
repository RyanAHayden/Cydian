# B127: Remove the Sources refresh strip

## What changed
- screens/sources.js: no more `stripEl`/`paintStrip`, `STRIP_HIDE_MS`, `state.strip`/`stripTimer`, and
  `state.retrying` (only the strip read it). Sources pins only its search bar: `pinned(el, bar)`. The rows
  (Waiting / spinner / count / red badge + reason), the tab badge (spinner, then the failure count) and the bottom
  reload bar are unchanged and are what tells you about a refresh now. As the task said, the count was not moved into
  the reload bar.
- core/refreshrows.js: `stripText` removed, along with its test in refreshrows.test.js.
- packages.css: the `.refresh-strip` rules and B126's `top: 24px` header offset rule (`:has(> .refresh-strip…)`)
  removed. The `.refresh-strip` CSS was in packages.css, which the task's file list did not name. No strip rules were
  in sources.css, style.css or ios6.css.
- sticky-header-css.test.js rewritten: across every web/app/*.css, no rule moves a `.section-header` /
  `.vlist-sticky` top off 0. Headers stick at 0. Sources has no strip (no `refresh-strip`/`stripText`/`paintStrip`)
  and pins only `bar`.
- Docs: nothing in docs/ or README mentioned the strip (grep for "strip", "Refreshing N of", "refreshed,"), so no
  doc change.

## Checked (headless Chromium over CDP, 390x844 @2x, safe areas 47/34, iPhone UA)
Scripts are kept here: `check.mjs` (a copy of the T12 capture script with a `measure` step, `media` step, 390x844,
and helper.run always answering a refusal after 6 s, so nothing reaches a phone) and `serve.mjs` (web/app served
statically, with `/api/fetch` answering 502 after 5 s so a website refresh lasts long enough to measure). For each
page, `measure` scrolls the list 200 px past its first section header and reports the bar's, scroller's and top
header's rects. Pages with no rows got an injected header plus 40 rows (Search, Changes on both shells; web Sources
had real rows). Native used the 4S's apt state from the main checkout's ref/4s as the fake shell's data (read only).
Measured with the reload bar up (html.has-reload, rows spinning) and again after the refresh ended:
- Web, light and dark: Sources' bar at 91–135, scroller at 135, "Individual Sources" header at 135–158, with the list
  scrolled. That is flush, during and after the refresh. Search and Changes: bar 91–135, scope bar to 179, header at 179. No
  `.refresh-strip` in the DOM. Web Installed with nothing installed is a short grouped page (no search bar, does not
  scroll), so there was nothing to check there.
- Native shell (fake ifizboxNative), light and dark: Installed (real dpkg status, virtual list): header "A" at 179,
  flush under the scope bar, during and after. Search and Changes: header at 179. Native Sources has one source, so
  its section is one row and the header scrolls away with it (normal sticky containment). Its pinned geometry (bar
  91–135, scroller at 135) is the same as on the web, where the header was flush.
- The other notice that pushes pages down, the queue run's Hide strip (`.qr-strip`, `body.qr-stripped`), was
  injected on the web. Strip at 91–121. Sources: bar 121–165, header at 165. Search: header at 209 under the scope bar. Home
  (a plain page-body scroller): header sticks at 121, right under the strip. All flush, so nothing to fix.
- Screenshots looked right: no dark bar under the nav bar, rows show Waiting/spinner/failed, badge on the tab.

## Not verified
- On a real iPhone (iOS 15 shell or iOS 26 web app): the task asked only for the fake-bridge check. The change only
  removes a node and CSS. The sticky behaviour is the same as on pages that never had a strip.
- Native Sources with a list long enough to scroll: the 4S data has one source, so the header could not be seen
  stuck there. The geometry it depends on (scroller top = bar bottom) was measured.
- Web Installed with packages: the website's Installed needs a chosen status file. Native Installed covered the
  same page with real rows.
