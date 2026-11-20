# B197 Pull to refresh haptics

What changed:
- `native/Sources/Apt.swift`: new bridge call `haptic.tick` beside `haptic.tap`:
  `UISelectionFeedbackGenerator().selectionChanged()` on the main queue (the lightest UIKit feedback).
- `web/app/nav/haptic.js`: `bridgeHaptics()` (the app bridge is there) and `hapticTick()` (posts `haptic.tick`; silent
  outside the app, since Safari's switch trick and `navigator.vibrate` have nothing lighter than `haptic()`).
- `web/app/nav/pullrefresh.js`: `pullTracker` takes `onHaptic(kind)`: `"tick"` on every entry into "armed" (so pulling
  back under the trigger and over it again ticks again, like the arrow turning each time), `"tap"` on entry into
  "refreshing" (an armed release that starts the refresh). A release that runs nothing, a cancel, or a pull while
  held plays nothing. `pullHaptic(kind)` gates both on `bridgeHaptics()`, as screens/roulette.js does, and
  `pullToRefresh` wires the tracker to it. A throwing haptic never stops the pull.
- Tests in `web/app/nav/pullrefresh.test.js`: the tracker's haptic sequence for each case, the bridge gate, and the
  real bridge messages (`haptic.tick`, `haptic.tap`) with a fake `webkit.messageHandlers`.
  `native/test_bridge_contract.py` sees the new `method: "haptic.tick"` call and its Swift handler.

Decided: the brief's file list doesn't include `native/README.md`, which lists bridge methods (`haptic.tap`); left
untouched to keep merges clean.

Tried and failed: nothing.

**Not verified**
- How the tick and tap feel on a phone: no device test (the task doesn't ask to drive the iPhone 7, and only the
  `.deb` build there has the bridge). The Swift compiles through the gate's native builds.
