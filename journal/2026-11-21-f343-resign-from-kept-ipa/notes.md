# F343: Re-sign without downloading again

## What changed

- `native/sign/OriginalIPA.swift` (new): the store for the IPA each signed app was signed from, as it came
  (unsigned): `Library/Caches/<bundle ID>.ipa`, keyed by the bundle ID the app was installed as (records are keyed
  by it too). `keeps` says which apps keep one (source is an http(s) URL, not iFizBox's own bundle ID either way),
  `stage` moves the signer's input aside as `<bundle ID>.<sha256>.pending`, `commit` swaps it in for the kept one
  when the install's record is written (Sideload.saveRecords), `discard` drops it when the install doesn't happen,
  so a failed or abandoned upgrade leaves the installed version's file in place; `take` gives Re-sign a hard link (else a
  copy) after checking the file's SHA-256 against the record's and removes a file that doesn't match, `dropped`
  says which files go when the record list changes.
- `SignedRecord.sha256` (native/sign/CertCheck.swift): the kept file's SHA-256 (F292's hash of the IPA as it came);
  nil when nothing is kept, and in records from before.
- `Sideload.signAndOpen` and `SignAhead.sign` move their input into Caches once it is signed (`keepOriginal`)
  instead of deleting it, and write the hash into the record. The install paths pass F292's hash along; Re-sign's
  download path hashes it there. A failed install (or a sign-ahead copy discarded/expired) takes the file back
  (`dropOriginal`) unless a record already has that very hash.
- Re-sign (`Sideload.resign`: signing.resign and signing.resignAll) and the queue's Re-sign (`signing.prepare
  {record}`) try `takeOriginal` before downloading. The log reads "Signing from the IPA kept at install (N MB), no
  download"; a missing file logs that iOS cleared it and then "Downloading …"; a mismatch logs that and downloads.
- `Sideload.saveRecords` removes the kept file of every record removed (signing.forget, B136's
  forgetUnlessInstalled) or replaced by one that keeps none (the same app installed from My IPAs).
- Test: native/sign/tests/sideload/main.swift "the IPA kept for Re-sign (F343)".

## Decisions

- My IPAs records and iFizBox's own (by its bundle ID, installed or original, and `self:bundle`) keep nothing, as
  the task says. The check is "source is http(s)", which covers My IPAs' `library:` and `self:bundle` without
  reaching into MyIPAs from native/sign.
- Settings has no storage row (searched web/app/screens/settings.js: no storage/size line exists), so no cache
  size is shown; the task asked for it only "if there is one".
- The sign-ahead path (native/Sources/SignAhead.swift, the IPA queue's Confirm run) is outside the task's listed
  files but signs and re-signs apps the same way; without it the queue's installs would keep nothing and its
  Re-sign would always download. Changed with small additions only.
- Re-sign from the kept file still runs SignAhead's F292 malware check (one more read of the file); the plain
  Re-sign path never had that check and still doesn't.

## Review

- The spec review found the first version replaced the kept IPA as soon as the new one was signed (before the
  install, and for sign-ahead even before Confirm), so a failed or discarded upgrade left the app with none. Fixed
  with stage/commit/discard above.
- Known and left: `saveRecords` reads the old list itself; two saves racing could remove a file that would have
  matched (costs one download, never a wrong sign). A `.pending` file left by a crash between staging and the
  answer stays until iOS clears Caches.

## Not verified

- On the iPhone 15 Pro: install the probe, re-sign with Wi-Fi off (Log shows no Downloading line), purge the cache
  and re-sign downloads again. Not done in this session: the run was unattended and I kept to the build and the
  Linux tests; the device check is the task's own Check, filed as R56 (after F343). Purging the cache by hand
  isn't possible from Linux either (an ad hoc app's container has no house_arrest access).
- That iOS really purges `Library/Caches` under storage pressure is Apple's documented behaviour, not tested.
