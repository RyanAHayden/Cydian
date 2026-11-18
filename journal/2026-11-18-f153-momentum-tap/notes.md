# F153: a quick tap during momentum scrolling opens the row

## Finding: WebKit never gets that touch at all
I first wrote a JS-only fix (`web/app/nav/momentum-tap.js`): notice a touch that starts while a list is coasting
and ends as a quick tap, cancel the native click and send our own. On the iPhone 7 it did nothing. A temporary
on-screen event trace showed why: a tap that lands while a list is coasting reaches the page as **no event at
all**, so no touchstart, no pointerdown, no click. UIKit's scroll view (WKChildScrollView) spends the touch on
stopping its deceleration. The task brief guessed pointercancel or the missing click, but neither happens: there is
no event for the tap. Same in iOS 15.8.8 Safari, tested on the same phone through an ssh reverse tunnel
(`ssh -R 8153:localhost:8153 7`, `python3 -m http.server` on web/app; the phone can't reach the desktop's port
directly). Screenshots taken just before and just after the tap differ, so the page was still coasting, and the
trace logged nothing for the tap.

## What I did
- `native/Sources/MomentumTap.swift`: a `UITapGestureRecognizer` on the WKWebView (cancelsTouchesInView false,
  recognizes alongside everything else). Its delegate's `shouldReceive touch` accepts a touch only if a
  `UIScrollView` between the touched view and the web view `isDecelerating`, so every other touch never reaches
  it. A tap (UIKit's own rule: under ~10 pt of movement, plus our 0.3 s limit) calls
  `cydianMomentumTap(x, y)` in the page. A drag fails the recognizer and only scrolls. One line in `App.swift`
  (`Web.make`) attaches it, so every list in the app is covered (Settings, Home, Sources, Changes, Installed,
  Search, package pages).
- `web/app/nav/momentum-tap.js`: `cydianMomentumTap(x, y)` clicks the tappable element under the point (link,
  button, `.cell-inner` row, bar button, alert button; never text fields or disabled buttons) with a real
  MouseEvent at those coordinates. It clicks only once: if WebKit sent a trusted click to the same target within
  350 ms, ours is skipped, and a trusted click that comes after ours within 350 ms is dropped. The JS touch path I
  wrote first is still there, for touches that do reach the page: a touch that starts within 120 ms of a scroll
  event with no finger down and ends within 300 ms and 10 px. `isQuickTap`, `coasting` and `tapTarget` are the
  pure rules.
- `app.js`: starts it after `initScroller`. The scroll handler that clears the pressed row now leaves it alone
  while such a tap is held (`heldTap()`).
- `web/app/nav/momentum-tap.test.js`: the time and distance thresholds, the coasting window, the target rule, the
  touch path (tap, drag, hold, drag-scroll that isn't momentum, uncancelable touchend) and the native call
  with its double-click guard.

## Checked on the iPhone 7 (jailbreak .deb built from this branch, 0.4.0-891)
- Installed tab: flick up (`swipe 375 1100 375 500 0.08`), then a tap at once (`tap 300 800`, ~0.4 s later
  through ssh). The row under the finger opened (libassuan0), one level deep (Back read "Installed", so no double
  push). Before the native part, the same steps only stopped the list.
- Flick, then a drag during momentum (`swipe 300 900 300 600 0.3`): only scrolled, nothing opened.
- Plain tap on a still list: opened the row once.
- I left this branch's .deb installed on the phone (0.4.0-891, without the debug trace).

## Not verified
- **Website (iOS Safari):** not fixed. The page never gets the tap, so page JS can't act on it. Filed R17 (low)
  to look into web-side options. The JS touch path only helps where a browser does send the touch.
- Settings and Changes on the phone: Settings fits on the screen so there is no momentum to test, and Changes was
  empty. The recognizer works the same on every WKChildScrollView, and I checked it on Installed.
- Package pages, Search results, Sources, Home inside the app: not tapped one by one, for the same reason (same
  mechanism).
- The sideload IPA build: it uses the same `Web.make`, but I didn't install it on a phone.
- iOS versions other than 15.8.8: the only test phone runs 15.8.8.
- Horizontal scrollers (Home's carousels): a tap while one coasts should open what's under it, but I didn't test it.
