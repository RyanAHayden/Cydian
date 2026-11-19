# F241: My IPAs' Install through the IPA queue's run

## What I did
- `core/appqueue.js`: `add()` takes `{ library: file }` instead of a url (job `url: null`, `library: file`, mode from
  version/installed as any install). New `libraryJob(entry, { installed })`: a My IPAs entry as such a job. Its id is
  the bundle ID it installs as (Sign Options' bundle ID, else the IPA's; `library:<file>` when unknown), so the run's
  `recordApp` records it in Installed under "My IPAs" like today's Install did, and a source job for the same app is
  replaced. Its Sign Options go along as `options.edits`.
  Why the edits: native `SignAhead.prepare {library}` signs with the options it is *sent* (`SignOptions(json: params)`),
  not the library's stored ones, so without them a renamed / re-IDed IPA would install as the plain IPA.
- `screens/myipas.js`: `queueLibraryInstall(entry)`; the sideload IPA page's Install calls it first. Signing Server
  reachable (`serverReachable`) -> `queueApp(job)` (Confirm opens; Confirm's run is F235's sign-ahead page with per-app
  stop; the walkthrough check is the run's `ready()`). Offline, unknown or unreadable entry -> returns false and Install
  stays `installFromLibrary` (sign now, keep the copy, the No Connection message). Website and jailbreak paths unchanged.
- `signing-client.js`: no code change needed (`prepareParams` already sends `{library, ...edits}`); doc note only.
- Test: `web/app/screens/myipas-queue.test.js` (libraryJob, add({library}), prepareParams/prepareOnDevice against a
  fake bridge, queueLibraryInstall online/offline).

## Decisions
- Sign (n) (Manage's bulk sign-and-install) still uses `installFromLibrary` one by one: the task names the IPA page's
  Install; moving Sign (n) to the queue would change Manage's flow and tests (not asked).
- A queued library install no longer refreshes the IPA page itself after the run (the old path re-rendered it after
  `installFromLibrary`); the page re-asks iOS what's installed when it's shown again.

## Not verified
- On a phone (sideload build): no device with the sideload IPA was in the task, and the iPhone 7 runs the jailbreak
  build, where this path is not taken. So the real `signing.prepare {library}` + `signing.open` round trip, the
  Confirm sheet with a My IPAs row, and the Installed record after the run are checked only against fakes.
- That the library entry's signed state (`entry.signed`) updates after a queued install: prepare keeps its signed copy
  in SignBridge.work, not in the library, so the row may still say "Not signed". Not checked on a device.
