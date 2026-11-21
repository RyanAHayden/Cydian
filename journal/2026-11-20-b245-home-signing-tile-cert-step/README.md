# B245: Home's Signing Needs Setup next to "Ready to Install"

Seen in B238 on the iPhone 15 Pro (Lite 0.18.1, Certificate None): Home showed the red "Signing Needs Setup /
Nothing can be installed yet" tile while Installation & Signing said "Ready to Install: through the Signing Server,
sign.ifizbox.com".

## What is actually true

With no certificate the sideload app can't install anything: every Install goes through
`signing/device.js firstInstallCheck`, which stops at "Set Up Signing" while `missingStep` answers "certificate".
So Home's red tile is right that setup isn't done. Installation & Signing's top cell
(`core/installroute.js installStatus`) only looks at the install route, not the certificate, so its "Ready to
Install" is the overstated half.

Decision (unattended, no one to ask): keep the red tile (it is the way to Settings > Signing, and installs really do
stop), but stop it claiming "Nothing can be installed yet" when the Signing Server is set. It now names the one step
left: "Import your certificate to install" (kept short: `.cell-subtitle` is one line with an ellipsis). Without an https Signing Server, and on the website, the tile is
unchanged. Installation's cell is outside this task's file: filed as B250.

## Changes

- `web/app/screens/home.js`: `signingSlot` keeps the https Signing Server (`httpsServer`) when the sideload app isn't
  set up; `slotTile` then swaps the setup tile's subtitle for `CERT_STEP_LEFT`. The server still isn't pinged before
  setup.
- `web/app/screens/home-certstep.test.js`: the new subtitle, the unchanged cases (no server, http server, website).

## Not verified

- Not looked at on a phone (the iPhone 15 Pro rig): a one-line subtitle change on an existing tile, covered by the
  unit test. The tile's width at 320pt was not rendered: the subtitle is 34 characters against 27 before, and
  `.cell-subtitle` (style.css) ellipsizes if it doesn't fit.
