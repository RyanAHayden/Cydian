# B89: iOS 27 froze the install server's socket

## What the evidence says

The user's log (iPhone19,2, iOS 27.0.1, 0.9.9-1676): `COSMCtrl evictBackgroundApps: evicting com.ryha.ifizbox` at
09:51:48, despite KeepAlive's silent audio, and no connection reached the NWListener until the 15-minute give-up
cancelled it and Network.framework logged "Resuming inbox socket". So iOS suspended (evicted) the process, and the
listener's inbox socket stayed suspended even when the app ran again later (the 10:00:32 timer ran in the app). A
frozen app runs no code, so nothing inside the app can keep the socket open while it is frozen. What the app can do is
notice the freeze afterwards and recover.

## What changed

- `InstallServer` (native/Sources/InstallServer.swift):
  - A 1 s heartbeat (DispatchSourceTimer on the server queue) runs while anything is served. A gap of 5 s or more
    (`freezeGap`) means iOS froze the app. The server logs "iOS froze iFizBox for N s, from to", re-creates the
    listener on **the same port** (the itms link and manifest name it; old one cancelled first, up to 5 tries 0.5 s
    apart if the port isn't free yet), and calls each route that isn't fully served yet (`Route.onFrozen`).
  - Going to the background, coming back to the front, the phone locking and unlocking go to the install log
    (`Route.note`). Back in front or unlocked, a listener that isn't `.ready` is re-created.
  - A listener that fails after it was ready, while an IPA is still served, is re-created.
  - `asked(path, since:)`: whether iOS asked for a path after a time.
  - Notes go through `Route.note`, never `Route.log`: Sideload's `serverLog` treats any log line as iOS asking for
    the IPA (`InstallPrompt.heard`), which would turn off B85's dismissed-prompt detection.
- `Sideload.serveChecked`: on a freeze, after `frozenGrace` (5 s) with no new request from iOS, `hostAfterFreeze`
  uploads a copy of the signed IPA to the call's Signing Server (`POST /sign/host`, the route iFizBox's own update
  uses). It then hands iOS that link through `InstallPrompt.open` (a new prompt once iFizBox is in front) and polls
  `GET /sign/host/<t>/status` every 2 s: started marks the prompt as heard, finished ends the IPA as served, and no
  fetch within 10 minutes ends it as not served. The local route stays served meanwhile, and its 15-minute expiry
  doesn't end the IPA while the server's copy is up. Once per IPA, and never after the IPA ended or a Cancel.
  If the upload fails, it stays local only.
  This doesn't call `hostAndOpen`, because that one triggers `CloseForUpdate`, which exits iFizBox.
- `KeepAlive`: when an audio interruption ends, the silent loop plays again (an interrupted loop is one way iOS
  decides the app may be suspended).
- docs/signing.md "What leaves the phone": the one case where another app's signed IPA now goes to the server.
- Tests: native/test_install_server.py `test_freeze_seen_and_listener_remade`,
  `test_freeze_falls_back_to_the_server` (source checks, like the rest of that file: the server can't run off the
  phone).

## Decisions

- I didn't pre-upload every IPA when the app goes to the background. That would send every app to the server on
  each app switch. It goes only after a freeze actually happened.
- I didn't change the Worker's manifest so the old link would point at a hosted copy. That's outside this task's
  files, and once iOS has said "Unable to Install" the user needs a new prompt anyway.
- InstallPrompt.swift: no change needed. `open()` replaces the bundle ID's entry, so the old link's pending retries
  stop (`entries[bid] === e`).

## Checks

- `make -C native package`: builds the .deb and the IPA (Linux cross toolchain).
- `python3 -m unittest test_install_server test_sideload` in native/: 15 tests OK.
- `tools/check.sh` via `agent-runner done`.

## Not verified

- **No capture of a failing attempt, and no fix tested on the phone.** The user's iPhone19,2 (iOS 27.0.1) was
  plugged in over USB (`idevice_id -l` listed it), but an install needs someone to tap Install and then leave the
  app or lock the phone. Nobody was there in this unattended run, and that phone has no remote-screen tool like
  `ui-7.sh`. So these are unchecked: when exactly the socket gets suspended (on eviction, I assume), that the
  heartbeat sees the freeze, that a listener re-created on the same port takes iOS's connections, and that the
  hosted fallback installs. Filed as R31: run an install that fails like this, with
  `idevicesyslog -m iFizBox -m installd`; the new log lines (background/lock/frozen/listens again/uploading) show
  each step.
- Whether iOS 27 suspends the *new* listener too while the app sits in the background again. If it does, the hosted
  copy still installs, since it doesn't need iFizBox.
- The upload's `URLSession.shared` task while iFizBox is in the background: covered by the server's
  `beginBackgroundTask` and KeepAlive, but not tried. If iOS freezes the app again during the upload, it carries on
  when the app runs next.
