# F167: a status bar tap scrolls the page to the top (app)

## What changed
- `web/app/nav/statusbar.js` (new): `statusBarTarget(doc, pageBody)` picks what to scroll: the last shown
  `[role=dialog]` (sheets, action sheets, the progress sheet, the share sheet), else the top page's body; inside it,
  the innermost scroller that is scrolled down (Search's `.search-results`, a sheet's list, `[data-scroller]`...).
  `makeScrollToTop` glides it with `nav/tabbar.js scrollToTop` (the tab re-tap's smooth scroll).
- `web/app/app.js`: `globalThis.cydianScrollToTop = makeScrollToTop(document, () => stacks.top()?.page.body)`.
- `native/Sources/StatusBarTap.swift` (new), attached in `Web.make` (App.swift): the native side, both builds
  (jailbreak and sideload share the one executable).
- Test: `web/app/nav/statusbar.test.js` (top page body glides, Search results, a sheet's list, hidden dialogs,
  nothing scrolled, and that app.js / App.swift are wired).

## Deviation from the brief, and why
The brief said: keep `webView.scrollView.scrollsToTop = true` and return false from its delegate's
`scrollViewShouldScrollToTop`. Built and tried on the iPhone 7: the delegate is **never called**. A diagnostic dump
of the window's scroll views showed the only `scrollsToTop` one was the WKScrollView (WebKit already sets it off on
its `WKChildScrollView`s, the `.page-body` scrollers), so it wasn't the "more than one" rule: the WKScrollView sits at
offset 0 with contentSize == bounds, and UIKit drops the tap for a scroll view that is at its top without asking the
delegate. A synthetic status bar tap in Settings did scroll Settings, so the tap itself reaches apps.

What works: a probe of our own, a 1 pt tall clear `UIScrollView` across the top of the web view with contentSize 3 pt
and contentOffset 1 pt (always "scrolled down"), the only scroll view with `scrollsToTop` (the web view's own is
set to false). Its delegate returns false (so it stays at 1 pt, ready for the next tap) and runs
`cydianScrollToTop()`. First try had `isUserInteractionEnabled = false` on the probe: still not called. UIKit only
picks interactive scroll views; with it on, it's called. The probe lies under the status bar (y 0-1 pt), where no
touch reaches the page anyway.

## Checked on the iPhone 7 (0.4.0-968 built from this branch, `tools/ui-7.sh`)
- Installed: scrolled down to the L packages (`before.png`), tapped the status bar: back at the top (`after.png`).
  A second tap at the top changes nothing (pixel-identical).
- Search ("li"): results scrolled down (`search-before.png`), tap: the results list is back at the top
  (`search-after.png`), the field and scope bar stay.
- Gotcha for the next one: `apt-get install` of a .deb with the same version as installed does nothing (binary
  unchanged); use `sudo dpkg -i` to reinstall a rebuild of the same commit.

## Not verified
- The glide itself on the phone: a screenshot right after the tap already showed the top (screenshots take longer than
  the scroll). The smooth scroll is the same `scrollToTop` the tab re-tap (F148) uses.
- A sheet's list on the phone (no long sheet came up without starting an install); covered by the node test only.
- The sideload IPA build on a phone: same executable and same `Web.make`, but no sideloaded copy was run.
- The phone was left with this branch's 0.4.0-968 build installed (it was 0.4.0-946).
