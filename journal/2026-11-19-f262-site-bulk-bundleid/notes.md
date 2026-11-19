# F262: website bulk updates/re-signs pass the bundle ID

## What I did
- `web/app/screens/queue.js`: new `siteInstallArgs(job)` builds signAndInstall's arguments for a queued job: url,
  name, plus `bundleId` (job.bundleId, else job.id, which appJob sets to the source's bundleIdentifier) and `version`
  (job.version, else job.installed). `installApp`'s and `resignApp`'s (url) site calls use it.
- `web/app/screens/installed.js` `manageInstall`'s site call uses it too (dynamic import of queue.js, as its
  resign path already does).
- No bundle ID for a My IPAs job (`library:` id or `library` set) or one whose Sign Options change the bundle ID:
  the site's plain sign doesn't apply those edits, so the ID would be wrong and the early link would point iOS at an
  app that never arrives. Those go the slow way (Ready to Install), as before.
- Test: `web/app/screens/siteinstall-bundleid.test.js`.

## Tried that failed
none

## Not verified
- A real website bulk Update/Re-sign in Safari on a phone with Keep Bundle IDs and a checked password (iOS's prompt
  opening at the tap): unattended run with no phone to drive; covered only by unit tests with a fake signing client.
