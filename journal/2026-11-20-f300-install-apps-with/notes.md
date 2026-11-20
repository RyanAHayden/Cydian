# F300: Installation & Signing — one Install Apps With row (sideload build)

## What changed
- Main page (`mainPage`, screens/installroute.js): Installation has one row, **Install Apps With**, detail from
  `withDetail`: "This iPhone · Paired" / "This iPhone · Not Paired" / "This iPhone" (no answer) / "Signing Server".
  The separate This iPhone and Signing Server rows are gone; Signing keeps Certificate and Signed Apps; How Signing
  Works stays. `MAIN_ROWS` = status, action, with, certificate, apps, help.
- Install Apps With's page (`installation/with`): the choice (This iPhone first now: `ROUTE_OPTIONS` reordered, the
  Signing Server is still the default) with its checkmark, then the chosen route's groups: This iPhone → This iPhone
  (Pairing, LocalDevVPN, Open LocalDevVPN), Connect With, Tailscale; Signing Server → settings.js `serverSections`
  (Server, Check Server, Run Your Own, and the server footer), passed in as `drawInstallation(..., { server })`.
  `installation/iphone` still works on its own.
- Tailscale the way in (core `tailscaleRoute`: Connect With Tailscale, or Automatic with tailscale.use / signed in
  and its VPN on): no LocalDevVPN row, Open LocalDevVPN or "LocalDevVPN must be on…" footer. While the page reads
  again, the last status read (`hint`) decides, so the rows don't flash in and out.
- Developer Mode row dropped, with its `idevice.developerMode` read (JS side; the shell still answers it).
  `developerModeFailure` (core/installroute.js) + one branch in core/signing.js `deviceError`: an install error whose
  code or text names Developer Mode alerts "Turn On Developer Mode" with the steps. CHECKING's subtitle no longer
  names Developer Mode.
- Checkmark choices: Install Apps With moves the checkmark at once and spins the row until idevice.status answers
  (the store's set redraws the page synchronously; a store that doesn't is redrawn by the pick itself, guarded by a
  per-element paint generation so an older paint never draws over a newer one). Connect With moves at once with the
  spinner in the row (no HUD now) until tailscale.setConnect and the status read after it answer.
- Picking This iPhone while not paired no longer jumps to the pair page (B120's rule): the Pairing row is right under
  the choice and the main status says Pair This iPhone. Decided because the brief wants the checkmark to move at once.
- `slideLayout`: groups kept across a repaint slide from their old place, new ones fade in from 12px above, the rest
  of the page slides as `slideBelow` did (transform/opacity only). F299's shared helper hasn't landed; swap to it then.
- Docs: docs/settings.md (Installation & Signing), docs/sideload.md (Developer Mode paragraph).

## Checked
- `node --test` on every installroute/installmain/settings-shown/installstatus/signing-client test; new
  `screens/installroute-f300.test.js`; `installroute-devmode.test.js` removed (its feature is gone).
- Headless Chromium with a slowed fake sideload bridge (`shot.mjs`): main page, Install Apps With with the server,
  a tap on This iPhone mid-read (checkmark + spinner, This iPhone's groups in), a Connect With → Tailscale tap
  mid-call (checkmark + spinner, LocalDevVPN rows gone). PNGs here.

## Not verified
- The slide animations themselves: shots are stills, and the fake DOM in tests has no layout. Not watched on a phone.
- The exact installd/installation_proxy error text when Developer Mode is off: not reproduced (no phone with it off
  in this run); the match is on "developer mode"/"DeveloperMode"/code developer_mode. If iOS words it differently
  (e.g. only ApplicationVerificationFailed), the alert falls back to the generic Couldn't Install.
- Nothing run on the iPhone 7 or a sideload device (the task didn't call for it).
