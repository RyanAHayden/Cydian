# F50: Open In by source format

## What changed
- `core/handoff.js`: `formatOf` now returns an alt: record's `format` (altstore, esign, scarlet, gbox; none or unknown
  means altstore, as with records from before F16a). New `isIpaFormat` and `OWN_APP`. Links per format:
  - **altstore**: the AltStore-format sideloaders (as F8).
  - **esign**: `esign://addsource?url=<url>` first, then the AltStore-format sideloaders, because ESign's JSON is
    AltStore 1.x with extra fields (F16).
  - **scarlet**: only `scarlet://repo=<url>`, the same form `detect.js unwrapLink` reads back (a test checks the round trip).
  - **gbox**: only `gbox://AddSource/<url>`.
  - A record with `unsupported` (an encrypted GBox source) gets only its own format's app, never the sideloaders.
    An unsupported AltStore record gets nothing; there's no such record today, but this way none is offered by mistake.
  - Package links on IPA sources are the source's links, as before; `addLink` treats every IPA format like AltStore (no suite).
- `screens/handoff.js`: uses `isIpaFormat` where it checked `=== "altstore"`, so non-AltStore IPA sources get the
  IPA footers and are shown whether or not the phone is jailbroken.
- `screens/manage.js`: Add Source's message now reads "Or an app source (.json): AltStore, ESign, Scarlet or GBox."
- Tests: six new node tests in `core/handoff.test.js`.

## Where each scheme came from (checked 2026-11-17)
ESign, Scarlet and GBox are closed source, so I took the forms from source sites found with GitHub code search:
- Scarlet `scarlet://repo=<url>`: many repo pages (QxAngel/qxangel.github.io js/script.js, GPLMods repos.ejs,
  FR-FFT/AgarioMods README through fwuf.in, …). The URL goes in raw after `repo=`.
- ESign `esign://addsource?url=<url>`: 61 matches, all with the URL raw (swaggyP36000/TrollStore-IPAs README, asjrx
  install page, …). I escape only `&`, `#` and space so they stay part of the value.
- GBox `gbox://AddSource/<url>`: only **one** public example, dvntm0/dvntm0.github.io 404.html, a multi-app redirector
  whose ESign and Scarlet forms match the common ones above. GBox's own README (GBoxApp/GBoxSource) names no scheme,
  and gbox.run's page has none. (`gbox://import/…` turns up too, but it belongs to an unrelated VPN client.)
  I shipped it because a wrong scheme only makes iOS say it can't open the link.

## Tried and failed
- GitHub code search ran into its rate limit partway; I retried after writing the code.

## Not verified
- None of the three links was opened on a phone. The 4S runs iOS 6 and can't run ESign, Scarlet or GBox, and no
  newer device is reachable from here. The GBox form is the weakest because only one site uses it. If it turns out wrong,
  change `OWN_APP.gbox` in `core/handoff.js`.
- Whether ESign accepts a percent-encoded URL in `url=`. I kept the raw form the sites use.
- The UI wasn't rendered in a browser. The change is in which links appear and in one alert string; the node tests
  cover the links.
