# T44: bridge contract test

## What I did

- `native/test_bridge_contract.py` (gate): reads every `on("<method>")` in the Swift that build.sh compiles
  (`native/Sources`, `sign`, `intents`, `share`, `sideload`; `native/spike` is a separate test app and is left out)
  and every bridge call in `web/app/**.js` (not `*.test.js`, not `vendor/`) plus `native/bridge.js`.
  - A call: a dotted name literal as a call's first argument, or its second after one plain argument
    (`native.call("x")`, `call(native, "x")`, `via("x", …)`, `abortable(native, "x", …)`, `native?.call?.("x")`),
    and `method: "x"` (nav/haptic.js posts straight to the handler). It counts when the function is named `call`, or
    when the name's first part is a namespace the Swift side uses. That keeps storage keys (`getItem("ifizbox.x")`),
    files (`fetch("build.json")`) and piracy-list hosts (`"apt.cydia.top"` in an array) out without an exclusion
    list; a namespace renamed on the Swift side only still fails through its `call(...)` sites.
  - Comments are blanked first (strings kept), so a call named in a comment doesn't count.
  - Templates: `library.${method}` (signing-client.js libraryCall, plus core/myipas.js, which gets libraryCall as
    `call`) and `share.${method}` (screens/sharedeb.js) are expanded from their wrapper calls (`TEMPLATES`). A template
    in a call that `TEMPLATES` doesn't know fails its own test.
  - Tests: every JS call has a handler; every handler is called (all 107 are, so dead handlers fail too); templates
    listed; every `on(` takes a literal; scanner self-check (known names of every call shape are found); the task's
    check, a renamed handler (`idevice.pair` → `idevice.pairNow`, in memory) fails exactly on that name.
- Removed the three handlers nothing called: `ping` (Bridge.swift; native/README.md no longer lists it),
  `idevice.vpn` and `idevice.developerMode` (sideload/idevice/IDeviceBridge.swift, header comment too), and with the
  latter `IDevice.readDeveloperMode` and `Session.developerMode`, which only it used. docs/sideload.md no longer says
  the shell answers it. Two web tests (`installroute-busy.test.js`, `installroute-check.test.js`) still list
  `idevice.developerMode` in their fake bridges; harmless (nothing asks it), left alone as outside this task's files.
- Checked by hand: renamed `clipboard.peek` in Bridge.swift to `clipboard.peekURL`: the test failed on
  `clipboard.peek (web/app/nav/menu.js:107)` and on the dead `clipboard.peekURL`; reverted.

## Tried and dropped

- Every dotted literal in call position, any function: flagged `getItem("ifizbox.transferDone")`,
  `fetch("transfer.link")`, `libellekit.dylib`. Every literal in a Swift namespace, any position: flagged piracy-list
  hosts and bundle IDs. The `call`-or-known-namespace rule above has neither problem.

## Not verified

- The removed handlers on a phone: nothing in web/app or native calls them (the test proves the JS side; `git grep`
  found no other caller), so there's nothing to see change. The Swift compiles in the gate's native build.
