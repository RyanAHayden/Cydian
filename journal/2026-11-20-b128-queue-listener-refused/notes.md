# B128: queued sideload installs after the first got ECONNREFUSED

## Cause (from the user's iPhone19,2 / iOS 27.0.1 log)
The first app installed on a fresh listener (127.0.0.1:52834). Its route went after the served grace, so no route
was served and the B89 heartbeat/revive did nothing. iFizBox was suspended for minutes; iOS shut the listener's
socket, but `NWListener.state` still said `.ready`. The next queued app's `InstallServer.start()` saw `.ready`,
reused it, put port 52834 in the manifest, and appstored's HEAD got connection refused (-1004 / errno 61).

## Fix
- `ListenerStart.decide` (native/sign/HTTP.swift, pure so it runs in the Swift test binary): with no route served,
  always `.fresh`. While routes are served (their links name the port): `.reuse` if ready and the heartbeat shows
  no gap of `freezeGap`, else `.revive` on the same port.
- `InstallServer.start()` follows it: `.fresh` cancels the old listener, zeroes the port and makes a new one on a
  random port (the manifest is built after `start` calls back, so it carries the new port); `.revive` runs `tick()`
  when a freeze gap shows (notes + onFrozen fallback as in B89) or `revive()` otherwise.
- The start listener's `.ready` handler ignores a listener that was replaced, and `.cancelled` before ready answers
  its caller with a failure instead of leaving it waiting forever.
- Queue runs: every item (signing.install, My IPAs, SignAhead's pre-signed items) goes through
  `Sideload.serveAndOpen`, which calls `server.start` each time, so each item now checks the listener. No change to
  Sideload.swift was needed; test_install_server.py pins that path.

## Tests
- Swift: `install server listener reuse (B128)` in native/sign/tests/main.swift (run by native/test_sign.py).
- Source: `test_idle_listener_never_reused` in native/test_install_server.py.

## Not verified
- On a phone (queue 2+ apps, background iFizBox > 1 min between, all install): this unattended run has no access to
  the user's iOS 27 phone, and the iPhone 7 runs the jailbreak build, not the sideload IPA. Needs the user's retest.
- Whether a fresh `NWListener` made right after the app comes back from suspension is ready before appstored's first
  request: the manifest check (a network round trip) runs between `start` and the hand-off, which should cover it.
