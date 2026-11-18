# F148: tapping the current tab again scrolls to the top

User 2026-11-18: "when pressing the current option at the bottom (eg. home) again it should scroll to the top".

## What I did
- `web/app/nav/tabbar.js`
  - `tapTab` takes a `scrollTop` callback. A tap on the tab you are on, at its root, calls `scrollTop()` and then
    the screen's `reselect()` if it has one (Search focuses its field, F36), both synchronously in the click
    handler. Below the root it still pops to the root (`selectTab`) and does not scroll; another tab still switches.
  - Behaviour change: before, a tap at the root of a tab without `reselect` called `selectTab` (a no-op route). Now
    it only scrolls. The old test that asserted that select was updated.
  - New `scrollToTop(body, win)`: nothing when already at 0 or without a page; otherwise stops a coasting fling
    (overflow-y hidden for one forced layout, a known WebKit way to end momentum, as UIKit's status-bar tap does)
    and `scrollTo({ top: 0, behavior: "smooth" })`, `"auto"` under prefers-reduced-motion.
- `web/app/app.js`: the tab bar handler passes `scrollTop: () => scrollToTop(stacks.top()?.page.body)`: the active
  tab's top page's `.page-body`. Same file runs the app and the website, so both get it.
- Virtualised lists (`nav/vlist.js`) re-bind rows from their scroller's `scroll` event, which smooth scrolling fires
  every frame including the last, so the top rows get drawn; no vlist change needed.
- Tests (`web/app/nav/tabbar.test.js`): every tab at root scrolls and doesn't select; below root selects and doesn't
  scroll; another tab doesn't scroll; Search scrolls then focuses (order); `scrollToTop` with a fake scroller
  (fling stop, smooth/auto, no-op at 0 and with null).

## Not verified
- On a phone (iPhone 7 app or Safari): the task didn't say to touch the test phone, and no browser runs here. So
  unchecked: the smooth scroll's look, that the overflow toggle really stops a fling on iOS WebKit without a jump,
  that a long virtualised list (Installed, a big source) shows its top rows on landing, and that on Search the
  focus() still raises the keyboard while the page scrolls (focus may scroll the field into view itself; it sits
  at the top, so the two agree).
