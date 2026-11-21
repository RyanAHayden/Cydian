# B282: Confirm's Statistics counts only what is downloaded

## What changed

- `web/app/core/appqueue.js`: `jobDownloads(job)` (new) says whether Confirm's run downloads a job's IPA: it has a
  url, and it is not a My IPAs file (`job.library`) or a Remove. `appPlan` adds a job's size to `download` only
  then (a dependency counts unless it is a library file, as before). A My IPAs Reinstall (R56's "Downloading
  20 kB") now shows no Statistics group.
- Tests: `core/appqueue.test.js` "appPlan's download counts only jobs that download (B282)",
  `screens/myipas-queue.test.js` asserts no download for library jobs.
- `web/app/screens/queue.js` needed no change: it draws `appPlan(jobs).download` as it is.

## Re-signs and the IPA kept at install

- A Re-sign of a signed app (`resignJob`) has no url and no size, so it already counted nothing; the shell signs
  it from the IPA kept at install (F343) or downloads it itself from the record's source, which the page can't size.
- A Re-sign with a url is a marked app's (`markedResignJob`: installed record, no signing record). F343 keeps the
  IPA only beside a signing record (its `sha256`), so a marked app never has one kept and the url really is
  downloaded: it still counts. No shell call tells the page about a kept IPA today, and none is needed for these
  two cases, so I added no flag for it (a field nothing sets would be dead code).

## Not verified

- On the iPhone 15 Pro (Confirm for a My IPAs Reinstall shows no Downloading row): not done, the run is
  unattended and the change is a pure-JS count covered by the unit tests above.

## Review

- Spec review: dropped an extra `op !== "remove"` check (a Remove has no url, so it never counted), made the comment
  say the test is the url alone, and wrote down why a dependency counts without a url (dependencies carry only a
  size; none are made yet).
