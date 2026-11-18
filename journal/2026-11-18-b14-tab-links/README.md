# B14: cydian://sources and the other tab links

cydian://sources (docs/iphone7.md's ui-7.sh example) opened Cydian on Home: the shell's `IncomingLink.hosts`
(native/sign/Handoff.swift) didn't list it, so `Incoming.receive` dropped it, and incoming.js had no handler either.

Chose to route the links rather than change the doc, because a tab link is useful for driving the phone and for Shortcuts.

- `IncomingLink.tabs` = router.js ALL_TABS (home, sources, changes, installed, search, settings), added to `hosts`.
- incoming.js `tabOf(link)`: only a bare `cydian://<tab>` (an optional trailing `/`, query or fragment); handleIncoming
  opens `#/<tab>` and returns "tab". `#/settings` lands on Home's Settings stack (router.parse, F123). A tab the
  sideload build leaves out lands on Home, also through router.parse.
- Warm launches take the same path: `scene(_:openURLContexts:)` -> `Incoming.receive` -> "cydian:url" -> app.takeURL ->
  handleIncoming. Cold: `scene(_:willConnectTo:)` -> the same, and the page takes it once at start.
- Tests: incoming.test.js (each tab, case, trailing slash, sub-paths refused); sideload swift test checks two tab hosts.
- docs/iphone7.md: a line under the ui-7.sh example saying what `open cydian://<tab>` does.
- App.swift needed no change: its routing goes through IncomingLink.

Nothing tried failed.

## Not verified

- On the iPhone 7, cold and warm: the task didn't hand me the phone's lock, and a hand test needs a .deb built with
  this change, which needs the Swift toolchain this machine doesn't have (`swiftc` isn't on PATH).
- The Swift change (Handoff.swift, the sideload test) wasn't compiled here for the same reason; check.sh skips the
  native builds without a toolchain.
