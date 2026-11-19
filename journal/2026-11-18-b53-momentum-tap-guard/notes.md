# B53: tap during momentum scroll only stops the scroll (blocked: conflicts with F153)

## What I found
B53 asks for a tap during momentum to only stop the list, as iOS 6 does, and calls the current "tap opens the row"
behaviour a bug. That behaviour is not an accident. It is **F153**, done today (2026-11-18) on the user's own request,
quoted in the plan: "when scrolling with momentum and tapping a setting it currently wont press go to it. a quick
tap not a scroll. it should open it". F153 built it on purpose:
- `native/Sources/MomentumTap.swift`: a tap recognizer on the WKWebView that fires only while a scroll view
  `isDecelerating`, and calls `ifizboxMomentumTap(x, y)`.
- `web/app/nav/momentum-tap.js`: clicks the row under that point, and also catches touches that do reach the page
  during a coast. `app.js` starts it (`initMomentumTap()`) and keeps the pressed look on for it (`heldTap()`).

F153's journal (journal/2026-11-18-f153-momentum-tap) also shows that the brief's plan wouldn't work as written.
Without F153, a tap during a coast reaches WebKit as **no event at all**: no touchstart, no pointerdown, no click.
UIKit spends that touch on stopping the deceleration. This was checked in the app and in iOS 15.8.8 Safari on the
iPhone 7. So without F153 the app and the site already behave the way B53 wants. The extra tap only comes from
F153's own code. A guard in app.js that swallows the click would just be fighting momentum-tap.js.

## Decision
I made no product change. B53's brief never mentions F153, which suggests it was filed without knowing about F153.
Silently undoing a feature the user asked for in their own words is not something an unattended run should decide.
I blocked the task so a person can choose:
1. Keep F153 (tap opens the row): close B53 as won't-fix.
2. Go back to iOS 6's behaviour: B53 then means removing F153. Drop `MomentumTap.swift` and its attach line in
   App.swift, plus `initMomentumTap()` and `heldTap()` in app.js (or make momentum-tap.js do nothing). No new guard
   is needed, because WebKit gets no event for that tap. Its files would be native/Sources/MomentumTap.swift,
   native/Sources/App.swift, web/app/app.js, web/app/nav/momentum-tap.js(.test.js).
3. Make it a setting (iOS 6 behaviour vs. tap opens).

## Not verified
- I took no iPhone 7 or 4S timing and drove no screens (ui-7.sh, ui-4s.sh), because no change was made and there
  was nothing to check. The claim that "without F153 no event reaches the page" comes from F153's journal; I did
  not measure it again.
