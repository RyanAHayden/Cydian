# B113 Plain-http IPA links in the jailbreak app

## The cause

The jailbreak app's `ipa.install` (Apt.swift `IPAInstall.run`) downloaded every IPA with `IPAInstall.session`, a
URLSession, which ATS keeps off plain http. B104 made it say so in our words ("Download Not Secure"), but an http
IPA still could not be installed at all.

## What changed

- `native/Sources/Apt.swift`:
  - `IPAInstall.fetchHTTP(url, twin:, insecure:, to:)`: for an http link, as B104's `Sideload.download`: without
    `insecure` it downloads the https twin with `Download` (20 s idle limit, `Sideload.twinTimeout`); when the twin
    fails (`Sideload.twinMissing`: anything but cancelled/too_large/offline) it answers `insecure: <host> offers this
    IPA only over plain http, without encryption`. With `insecure` it goes straight to F238's `PlainDownload`. The file
    lands directly in the helper's IPA folder (`IPAInstall.dir`), so the helper step is unchanged. Progress goes out as
    `dlstatus:ipa:<pct>:Downloading` (only on this path; the https URLSession path still shows one Downloading line).
    `Download`/`PlainDownload`'s "the server answered 404" becomes `not_found: HTTP 404 for <url>`, as on the https path.
  - `IPAInstall.run(url, insecure:)`: the helper step became the `install(path)` closure both paths use; http links
    take `fetchHTTP`, https links the URLSession as before. `Run.fetch` holds the http download so `ipa.cancel` stops it.
  - The https path's ATS refusal (an https link that redirects to http) now answers `ats: …` (what B104's `Download`
    does) instead of iOS's sentence.
  - The `ipa.install` bridge call reads `insecure` from its params.
  - I reused `Sideload.httpsTwin`, `twinMissing` and `twinTimeout` (internal statics) rather than copying them, so
    `Sideload.swift` is untouched.
- `web/app/ipa-install.js`: `installIpa(url, onEvent, { insecure })` sends `insecure: true` only when set. `runIpaInstall`
  takes `ask` (default `askInsecureIpa`, which shows `INSECURE_IPA_ALERT` via a lazy import of nav/alert.js so the
  module stays DOM-free for node). On `insecure`: a warning line "No https copy of the IPA: …", the status reads the
  alert's title, then the alert. Install Anyway: the call again with `insecure: true`. Cancel: resolves
  `{ cancelled: true, declined: true }`. A link let through is remembered for the session (`allowedHttp`), so Try
  Again after AppSync's fallback, or the same link again, doesn't ask twice.
- `web/app/screens/ipa-install.js runIpaConsole`: on `declined` the page closes (back where Install was tapped), as its
  own Cancel does. The queued-app run (`screens/apprun.js helperLanes`) needed no change: `cancelled` already ends the
  row as cancelled, and it calls `runIpaInstall`, so it asks too.
- `web/app/core/ipainstall.js ipaError`: `insecure` where nothing asked (share.js's stand-in) gets our words, titled
  "This Download Is Not Secure".
- `native/fake/fake-native.mjs`: the fake `ipa.install` follows the same http rules (twin, `insecure:`, plain http
  with `insecure: true`).
- `docs/signing.md`: a paragraph on the jailbreak app under "Plain http IPA links".

Every way in from the brief ends in `runIpaInstall`: `ifizbox://install` (incoming.js → `openIpaInstall`),
Settings > Install IPA (`askIpaUrl` → `openIpaInstall`), app pages (altstore.js → `openIpaInstall`), IPA links
(`initIpaLinks`), and queued apps (`helperLanes` → `runIpaInstall`).

## Tests

- `web/app/ipa-install-insecure.test.js` (new), against the fake bridge and helper: twin exists → no alert, one call;
  no twin + Install Anyway → second call `insecure: true`, installed, then no second alert for the same link; Cancel
  → declined, one call, no error; https and missing-twin-then-404 don't ask twice; `askInsecureIpa`; `ipaError`
  insecure; a queued row ending as cancelled; Apt.swift's shape (insecure passed, twin and PlainDownload in
  fetchHTTP, http branch before URLSession).
- The existing IPA tests (ipa-install, ipa-cancel, backend-native-ipa, insecureipa) pass unchanged.
- `make -C native package`: builds the .deb (0.9.9-1979) and the IPA; no warnings from Apt.swift.

## Not verified

- **On the iPhone 7.** The brief doesn't ask for a phone run, and other slots overwrite the .deb on the 7 while they
  test (memory: iphone7-deb-overwritten-by-other-slots), so I didn't install this branch there. Not seen on a device:
  the twin download into the helper's folder, PlainDownload into it after Install Anyway, the helper then installing
  that file, the alert over the install page, the per-percent Downloading bar, and ipa.cancel stopping a
  PlainDownload. The pieces are B104's (`Download` with a timeout, `PlainDownload`), which B104 ran on the 7 through
  `library.add`; the new code is the wiring.
- **The `ats:` answer on the https path** (an https link that redirects to http): not triggered anywhere; it needs a
  server that redirects https to http.
- **The twin's 20 s limit against a host whose port 443 hangs** (BigBoss-style): not timed, as in B104.
