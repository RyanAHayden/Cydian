# B250: Installation & Signing's status cell knows the certificate

Seen on the iPhone 15 Pro (B238/B245): the top cell said Ready to Install (Signing Server) with Certificate None, and
every install then stopped at Set Up Signing (signing/device.js firstInstallCheck).

## What changed

- `core/installroute.js` installStatus takes `certificate` (whether signing.status has an identity, the rule
  statusReady / firstInstallCheck go by). `false` returns `NO_CERTIFICATE`: Import Your Certificate, "Installs need
  your certificate and its profile first.", action Import Certificate, warn tone, on either route (This iPhone signs
  on the phone too, so it needs the certificate as much). `undefined` (not read yet, or the read failed) keeps the
  route's own answer, so a failed signing.status never claims the certificate is missing.
- `screens/installroute.js` mainPage keeps the last `ready` from `signing()` and repaints the cell when it changes;
  the new action opens the Certificate page (the same href as the Certificate row) with nav/go.js, so it slides in.
  With This iPhone and this refresh's idevice.status still out, a certificate turning up paints Checking… until it
  answers.
- `screens/settings.js` drawMain's `signing()` adds `ready: Boolean(kept)` (left out when the read failed).
- Test: `screens/installroute-b250.test.js`.

Decision (unattended): the action row's label is "Import Certificate" (the title already says Import Your
Certificate, the Signing walkthrough's step name); it goes to the Certificate page rather than the walkthrough,
since that page holds the import.

Spec review: the first draft still painted Ready to Install on the Signing Server route for the moment
signing.status took on the first visit. Now that route shows Checking… ("Your certificate.", `CHECKING_SERVER`, action
dimmed) until signing() first answers; a failed read then gives the route's own answer. Also added a test for
signing answering before idevice.status on This iPhone. Kept, as the review flagged it as extra: the rule on This
iPhone too (queue.js runs firstInstallCheck for every local-signing install, whichever route), and the action row's
new action (the row is always there and needs one). `ready` is `Boolean(kept)`, which is statusReady, the same rule
firstInstallCheck's missingStep uses.

## Not verified

- On the iPhone 15 Pro (no certificate kept): not run there; the phone's Lite build and the screen drive were not
  part of this low-priority fix. The node tests drive mainPage with the fake DOM.
- The 320pt two-line fit of the new subtitle: judged by length against the existing subtitles (shorter than
  "Turn on the Tailscale app's VPN. Installs use … for now."), not rendered.
