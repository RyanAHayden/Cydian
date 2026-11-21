# B252: Lite keeps running from Confirm on

B246's phone runs on the 15 Pro: with iOS Settings in front from 3 s after Confirm, nothing ran for 2.5 min, and the
page chose the route only once the app was back. KeepAlive (the silent audio loop) was only held by the download,
the serving of the IPA to iOS and This iPhone's copy, so the steps between Confirm and those (the page's route check,
`idevice.status`, and the signing itself on SignBridge.queue) ran with nothing keeping the app awake.

## What changed

- `Sideload.install` (signing.install) takes one KeepAlive hold when the call starts and gives it back when the call
  answers (both `finish` cases and each early return), through `Sideload.holdUntilAnswer()` (a `Once`, so a doubled
  release can't take another install's hold). The download, serving and This iPhone's copy keep their own holds, so
  nothing ends sooner than before.
- New bridge call `signing.hold {on}` (`Sideload.hold`, registered in SignBridge.swift): the page's own hold, one at
  most, with a 10 minute limit after which it lets go by itself (logged), so a page that never says off can't keep
  the app awake.
- `web/app/signing/route.js installOnDevice` sends `signing.hold {on: true}` at once (before `chooseRoute`'s
  `idevice.status`) and `{on: false}` when the install ends, whichever way. Not awaited, errors ignored: an older
  shell without the call refuses it and the install goes as before.
- Five tests that list the exact bridge calls now expect the hold around signing.install (install-cancel,
  markedresign, signing-client-device x2, signing-sheet).

Why the page call and not only a native hold: the route is chosen in the page before signing.install is sent, so
no native call marks Confirm except the page's own. A hold in `idevice.status` was the other choice, but Settings
polls that call (waitForVPN) and it would hold the audio session for no install.

## Not tried / left out

- The IPA queue's run (SignAhead: signing.prepare / open), My IPAs' library.install and Re-sign All have their own
  entry points; B252 is the Confirm → signing.install path. They take KeepAlive from their download/serve steps as
  before.

## Not verified

- **On a phone**: not run. Needs the new Lite build on the 15 Pro and the same test as B246's (Confirm, then iOS
  Settings in front within 3 s, watch the log go on). Not done in this session: building and installing a Lite
  build on the 15 needs the MBA/signing round trip B246 used, too long for this small change; the Swift builds in
  the gate do check it compiles.
- **Whether the page's JavaScript runs while the app is in the background** with KeepAlive held: the native side
  (signing, the copy) does, as B246's runs showed. If WebKit suspends the web content process anyway, the route
  check (`chooseRoute` awaiting `idevice.status`'s answer) would still wait for the app to come back, though the
  signing would not. Why it likely does run: the shell answers a bridge call by evaluating script in the page, and
  WebKit keeps the web content process running for such a request; from `idevice.status`'s answer to the
  `signing.install` message, the page code runs as one chain of awaits with no timer in between, so the whole chain
  finishes inside that one evaluation. The phone test above answers it; filed as an R task (spec review's point).

## Spec review

Fresh subagent, diff + brief only: no wrong code found. It pointed out that the route-decision half is not shown to
run in the background (see Not verified) and that the other entry points (IPA queue, My IPAs, Re-sign All) aren't
held from their own buttons. That second point is out of B252's scope (its path is Confirm → signing.install). Both
are recorded above; the phone check is filed.
