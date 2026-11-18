# I7: promote the Cydian app on the website

## What I did
- **core/appoffer.js** (new, pure): when the website offers Cydian itself. `homeOffer({ mode, deviceType,
  certificate })` gives Home's tile: Not Jailbroken + certificate = sign and install the sideload IPA; Not
  Jailbroken without one = Settings > Signing; jailbroken = the .deb for the arch; inside the app (either build) = no
  tile. `signingRowShows` / `offerAfterImport` cover the Signing page's green row and the one alert after the import
  that made the certificate work. `debUrl` / `debAlert` pick the .deb (latest release's asset for the arch through
  selfupdate.js `debFor`, else the plain rootless Cydian.deb) and the alert before the download.
- **Home** (screens/home.js): the existing Install Cydian App tile now goes through `homeOffer`, so it also shows
  while jailbroken on the site: the alert says the .deb downloads to Files to open in Sileo or Filza, then Download.
  Rootful gets "No Build Yet" (only a rootless .deb is released today). REPO_URL and APP_IPA_URL moved to appoffer.js.
- **Settings > Signing** (screens/settings.js): a green Install Cydian App row under the Certificate block once the
  certificate works (a .p12, a profile, a password not known to be wrong), and after an import (Browse, or the
  password that makes it work) the alert "Your certificate works. Install the Cydian app: it signs on your iPhone,
  no server, smoother scrolling at 120Hz" with Not Now / Install. Install = `signAndInstall` with the release IPA.
  Website only: `localSigning()`/sideload never shows it. Styles in home.css (`.app-offer`).
- **Cydian's own package page**: `web/app/source.json`, an AltStore 2.0 source with the one app
  (com.ryha.cydian, v0.1.1, the release's versioned Cydian.ipa and its real size 2331028 B), first in
  `DEFAULT_ALT_SOURCES` (by its raw.githubusercontent.com URL on main). `tools/altsource.py` writes/checks it;
  `tools/test_altsource.py` checks it in the gate (well formed, its own release tag, never ahead of native/VERSION,
  first default). Fixture copy `web/fixtures/altstore/cydian.json`; altstore-sources.test.js and github.test.js
  updated for the extra default.
- **Release asset**: already published: release v0.1.1 (= native/VERSION) carries Cydian.ipa and Cydian.deb. To keep
  it current, `tools/release.sh NOTES.md` builds, creates the release or replaces its assets (`--clobber`) and
  rewrites source.json. I did **not** run it: nothing to publish (latest already matches VERSION), and publishing
  is a person's step.
- Node tests: core/appoffer.test.js (cert set or not, in the app or not, Not Jailbroken or not; the .deb choice).
- Headless Chromium shots (tools/shots.mjs): the tile shows with and without a certificate and when jailbroken; the
  Signing page shows the green row with a certificate saved; no page errors.

## Decisions
- Label kept **Install Cydian App** (the task's own words and the existing tile), not the later note's "Install on
  Device", so the tile, the Signing row and the alert say one thing.
- The source is hosted on raw.githubusercontent.com (main), not cydian.dev, so it doesn't depend on the site.
- The alert shows on the transition to "works" only; Not Now isn't remembered beyond that (a later import of a
  different certificate asks again).

## Not verified
- The real install on an iPhone (sign through cydian.dev, itms-services, the .deb opened in Sileo/Filza): needs the
  user's phone and certificate.
- The import alert's flow in a browser (the shots save the identity directly, which doesn't go through Browse); its
  rule is node-tested.
- Visitors whose AltStore defaults were already seeded don't get Cydian's source (seeding runs once, F28); new
  visitors do. Not changed: re-seeding would bring back defaults people deleted.
- AltStore/SideStore reading source.json: only Cydian's own parser is tested.

## The gate's native build (fixed on the way)
The first `done` failed in `make -C native package`: swiftc "libncurses.so.6: cannot open shared object file".
native/build.sh has an Arch shim for that, but its test was `ldd "$swiftc" | grep -q ...` under `set -o pipefail`:
grep -q quits at the match, ldd can die of SIGPIPE, the pipeline counts as failed and the shim is skipped. Alone it
built fine (it lost the race only beside other slots). Now the test reads ldd's whole output into a string first.

The second `done` failed in native/sign's Swift tests: "sign with the user's edits" expected an explicit profile to
remove ["PlugIns/Share.appex", "PlugIns/Widget.appex"] and got them the other way round. IPASigner.swift walked
`bundles.keys`, a Swift Dictionary, whose order is seeded per process, so the test passed or failed at random. It
now walks `bundles.keys.sorted()`.
