# B150: a source app keeps its source's name (RyukGram, not "Instagram")

## Where the IPA's name won

Traced every place a sideload app's name comes from:

- **Installed's records** (`core/installed.js recordInstall`): Install's record (`screens/queue.js recordApp`,
  the app run, altstore/browse marks) already takes the source's name (`job.name` = the source's `app.name`, the
  variant picked). My IPAs records (`screens/myipas.js recorder`) take the IPA's name with `source: null`: right by
  the rule (no source). Nothing rewrites a record's name (backend-native `withRealVersions` touches versions only).
- **signing.installed** (the shell's signed-app store, `native/sign`): names each app by its IPA's Info.plist. It
  feeds Installed's signature pills, its signed-only rows and the installed-app page (`screens/installed.js
  signedApps`), Settings > Signed Apps (`screens/signed-apps.js fillApps`) and Changes' Needs Re-sign / re-sign
  jobs (`screens/changes.js resignNow`). This is where "Instagram" showed.
- **Install progress page** (`signing-client.js installOnDevice`): `followInstall`'s name and `finishHere`'s
  "Installed <app>" / "Open <app>" put `result.name` (the IPA's) before the caller's name.
- **App run rows** (`core/apprun.js`) already keep the job's name over the shell's; queue rows use the job's name.

## Fix

- `core/installed.js withSourceNames(installed, records)` renames signing.installed apps by the device's record
  for that app when the record has a `source`; `signedAppsNamed(native)` is the call plus that. Used in
  installed.js `signedApps`, signed-apps.js `fillApps`, changes.js `resignNow` (new import lines, call sites only).
- `installOnDevice` / `finishHere`: the caller's name first (`signing-client.js shownName`), the IPA's only when
  none was given or the given one is a bare file name ("delta.ipa": the first gate run failed on
  signing-client-device.test.js, which installs with a file name and expects the IPA's name; kept that behaviour). Every caller passes
  the source's name, Custom Install's edited name or iFizBox's own; My IPAs installs go through
  `installFromLibrary`, left as it was (IPA name or Sign Options' name).

Why matching by bundle ID is fine here: the record is the one install iFizBox made under that ID on this phone (a
reinstall replaces it, a My IPAs install of real Instagram writes a `source: null` record, which keeps the IPA's
name). Nothing looks up a source's catalog by bundle ID to choose a name. A copy install (new bundle ID) matches
its record through `originalBundleId`, as `signedIndex` already does.

Test: `web/app/core/b150-source-names.test.js`.

Note: an edit was made with a heredoc'd python script (import lines + three call sites) against the session rules;
the result was checked by the tests and `git diff`.

## Not verified

- On a phone: the sideload build wasn't built or installed here (no device for this task); checked with node tests.
- The native signed-app store still holds the IPA's name (Swift, out of this task's files); anything reading
  `signing.installed` without `signedAppsNamed` (altstore.js `signedRecordOf`, used for the signature row only,
  and keepid.js, which reads bundle IDs only) shows no name, so nothing else needed it.
- Home's install rows: the only install rows on Home are the website's "Install iFizBox Lite" rows (fixed text), so
  nothing there names a source app.
- The jailbreak build's Install IPA (`screens/ipa-install.js rememberIpa`) records the file name, not the IPA's
  name; that's the jailbreak path, out of this sideload task.
