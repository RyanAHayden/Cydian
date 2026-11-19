# B60: tab bar reselect spam

## Problem
B57's `scrollToTop` (web/app/nav/tabbar.js) replaced a running slide on every call: each new tap stopped the last
slide, ran the overflow toggle (momentum stop) again and started a fresh 300 ms ease-out from where the list was.
Spamming the tab made the list lurch and restart, and `tapTab` ran the screen's `reselect()` on every tap
(Search refocused its field each time).

## Fix
- `scrollToTop(body)`: if a slide is already running on that body, it returns `true` and does nothing (no stop, no
  overflow toggle, no restart). The check comes before the "already at the top" check, so a call mid-slide is
  always a no-op. The status-bar tap (statusbar.js, same function) gets the same behaviour, which I think is right:
  one tap = one slide, a second tap while it runs adds nothing.
- New `isSliding(body)`: true while a slide runs (the WeakMap entry, removed when it lands or a touch stops it).
- `tapTab(..., { sliding })`: at the root of the current tab, if `sliding()` is true it returns `"busy"` without
  calling `scrollTop` or `reselect`. Without `sliding` it behaves as before.
- app.js passes `sliding: () => isSliding(stacks.top()?.page.body)`.
- Unchanged: a touchstart on the list still stops the slide (and then the next tap slides again); at the top a tap
  doesn't move the scroller, and `reselect()` still runs there (Search focuses, as today). The reduced-motion jump
  and the no-rAF `scrollTo` fallback register no slide, so nothing is ignored there.

## Tests (web/app/nav/tabbar-slide.test.js)
- B57's "a second tap mid-slide replaces the first" became "a second call mid-slide is ignored" (no extra
  scrollTop write, no second overflow toggle, one frame pending, lands on 0).
- 5 quick reselects through `tapTab` 40 ms apart: results `reselect, busy, busy, busy, busy`, `reselect()` once,
  one momentum stop, writes never go back down, ends at 0; a tap at the top afterwards doesn't touch the scroller.
- After a touch stops the slide, the next call slides again to 0.

## On the iPhone 7
The phone had iFizBox 0.9.7-1435 installed. Its `web/app.js` differed from this branch only by my two lines and one
comment, and `nav/tabbar.js` imports nothing, so instead of building a .deb I copied this branch's two files into
`/var/jb/Applications/iFizBox.app/web/` (originals saved first), killed the app and opened `ifizbox://installed`.
I jumped to the bottom with the section index, then `spam.sh` (here) fired 5 `ui-7.sh tap`s on the Installed tab
~60 ms apart (each call takes ~430 ms over ssh, so they overlap and arrive in a burst) and took a screenshot during
the burst and one after it. `app-spam.jpg`: before the burst | during it | 1 s after it. The list was already at the
top in the middle still and stayed there: no bounce back down and no second slide.

Failed first try: a second index tap landed on the `vi` row and pushed its page, so the first tap of the burst
popped back to the root instead of reselecting. I redid it from the root.

Afterwards I copied the original files back (`dpkg -V com.ryha.ifizbox` reports nothing, so the installed files match
the package), pressed Home and released the UI lock.

## Not verified
- **Smoothness on screen ("no stutter").** phonectl only takes stills (~100–180 ms each) and a tap over ssh takes
  ~430 ms, so I can't film the slide or time the taps inside one 300 ms slide. The node test proves that later taps
  don't touch the running slide (no extra writes, no second overflow toggle), which is what made it stutter. A person
  tapping the tab fast on the phone is the last check for feel.
- **Search refocusing on the phone.** I didn't spam the Search tab on the device; `reselect()` running once is
  covered by the node test.
- **A .deb build of this branch.** I swapped the web files instead; `tools/check.sh` (run by `done`) builds the deb.
