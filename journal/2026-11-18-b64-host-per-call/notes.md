# B64: the hosted upload is chosen per call

## The bug

`Sideload.hostServer` and `Sideload.manifestServer` were statics. Each `signing.install`, `signing.resign` and
`library.install` call set them on the main thread when it started, and `signAndOpen` read `hostServer` only once
signing had finished on `SignBridge.queue`. The app queue (`web/app/screens/queue.js`) lets jobs overlap (`after`
follows iOS's install while the next job starts), so iFizBox's own job (`host: true`) could start while another app
was still signing. That app then found `hostServer` set and uploaded itself to the server's `/sign/host`. This matches
the user's report: "This server hosts only iFizBox's own signed app", which iFizBox's own upload under a `*` profile would never get.

## The fix

- `Sideload.Servers { manifest, host? }` is built from each call's params (`Sideload.servers(c, allowHost:)`) and
  passed through `signAndOpen(..., servers:)` and `serveAndOpen(_, server:, ...)`. Both statics are removed, so no
  shared state is left for a later call to change.
- `host` is set only when the call says `host: true`. Re-sign All (`resign(c, allowHost: false)`) and My IPAs'
  `library.install` (`allowHost: false`) never host. Re-sign All never got `host` from the JS anyway; this pins it.
- `manifestServer` had the same race. Two calls in a row could only differ if the Settings server changed between
  them, but it now travels with each call too.

## Tests

- `native/test_sideload.py` `test_host_chosen_per_call`: a source check (the Swift files using UIKit don't build on
  Linux, so there's no Swift test path for Sideload.swift). It checks that no `static var hostServer/manifestServer`
  is left, that `signAndOpen` takes `servers:` and hosts only on `servers.host`, and that Re-sign All and My IPAs pass
  `allowHost: false`. The old `takeServer` assertion in `test_no_local_trust_left` now checks the new guard.
- `web/app/screens/hostself.test.js`: Custom Install and `signing.resign` send `host: true` only for iFizBox's own
  IPA/ID, and a marked app's re-sign of another app goes through `installOnDevice` without host.

- The first gate run failed: `native/test_install_server.py` checks `serveAndOpen`'s call in My IPAs word for
  word. I updated it to the new `server: servers.manifest` argument.

## Not verified

- I didn't reproduce the race on a phone. The iPhone 7 runs the jailbreak build, which refuses `signing.*`, and no
  sideload-build phone is set up for agents. The fix comes from reading the code: the two statics are gone, so a
  later call has nothing it can change.
- Running behaviour of the sideload build (a real self-update upload and a real overlapping queue) is untested for
  the same reason. Only the compile is checked: `native/build.sh` built both, `build/iFizBox.deb` (jailbreak) and
  `build/iFizBox.ipa` (sideload), with no errors.
