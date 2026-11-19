# R29: check B83's sideload self-update on a phone running the Lite build

## Result: blocked, the phone test needs the user

The brief asks for a phone running the sideload (Lite) build, and says to ask the user for it. This was an
unattended run with nobody to ask. The only phones set up here are the 4S (reference only, never runs iFizBox) and
the iPhone 7 (jailbreak .deb only, and in the jailbreak build `signing.*` is refused). So none of the phone steps
were run.

## What was checked instead (server side, 2026-11-19)

- B83 is on main (merge `3582c29`).
- The live Worker has B83's status route. `GET https://ifizbox.com/sign/host/<48 zero hex>/status` returned
  `{"manifest":false,"started":false,"finished":false}` with HTTP 200, not a 404. So the app will poll for real
  and won't fall back to the old 8 s close (that fallback happens after three 404s).
- The KV wait is live too. `GET .../manifest.plist` for an unknown token answered 404 after 4.7 s instead of
  right away, which matches `HOST_WAIT` (6 s), allowing for the poll step.

## Not verified

All of the brief's phone steps. Each one needs the user's phone with the Lite build installed, and this run could
not ask for it:
- Upgrading iFizBox while another app installs: iFizBox stays open, the progress page shows the "Finishing the
  update" lines, and the app closes only after iOS has the IPA.
- iFizBox opens on the new version the first time.
- Cancelling iOS's install prompt once shows "Not Updated" with Try Again after about 2 min (`notStarted`).
- Whether the edge caches the status key's first not-found read and delays `started`/`finished` by up to about
  60 s. This can only be seen on a real update.

To unblock: the user runs these steps on their phone (Lite build of a version older than main, then Upgrade),
or tells a session which device to drive.
