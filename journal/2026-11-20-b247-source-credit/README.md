# B247: RyukGram shows as "Instagram" again

The user's Lite app listed RyukGram as "Instagram · Version 454.0.0 · AppTesters IPA R…" in Installed. B150 names a
signed app by the Installed record kept under its bundle ID, but AppTesters' Instagram entry lists the same ID
(`com.burbn.instagram`), and the record named that entry. Which path wrote the AppTesters record on the user's phone
is not known (an Update offered by `candidates()`, which looked up the newest version of the bundle ID on any source, is
one candidate; B156's restore by URL another). The fix takes the bundle ID out of the decision where it can.

## What changed

- **Shell keeps the credit.** `native/sign/SignOptions.swift`: `SourceCredit {name, source, sourceName, key}`, parsed
  from a sign call's `credit` param into `SignOptions.credit`. `SignedRecord.StoredOptions.credit` stores it (so
  Re-sign from the record keeps it; left out of `==`, which My IPAs' "signed with its own options" check uses).
  `SignedRecord.json` hands it back on `signing.installed`. The sign log ("Signed RyukGram 454.0.0 as …"),
  Re-sign's log, the reminder's names and the replies of `signing.install`/`signing.prepare` use
  `shownName`: the user's rename, else the credit's name, else the IPA's.
- **Pages send it.** `core/installed.js sourceCredit(job)` builds it from a queue job from a source (appJob's
  `source` is the source's URL, `key` its catalog key). `signing/queue.js prepareParams` (the queue's sign ahead) and
  `screens/queue.js installCustom` (Custom Install) add it.
- **Lists match on it first.** `withSourceNames` (Signed Apps, Needs Re-sign, Changes, Installed's signed-only rows)
  takes the credit's name before the record's. `creditedRecords` rewrites Installed's rows from it (name, source,
  source name, key), and `screens/installed.js recreditRecords` writes the corrected record back with the credited
  entry's icon, date kept. `sourceRecordFor` (B156) uses the credit before the URL. `candidates()` asks the record's
  own source (its key) for an upgrade first, then any source.
- **Apps signed before this.** No credit on their record. `urlCredit`: when the record's entry doesn't offer the
  signed IPA's URL and another entry does, that entry is credited and written back. This is what fixes the user's
  existing copy without a reinstall, if RyukGram's source still offers the URL it was signed from.
- Test: `web/app/core/b247-source-credit.test.js` (two sources listing `com.burbn.instagram`), plus a Swift case in
  `native/sign/tests/sideload/main.swift` ("B247: source credit on the signed record"). `originalqueue.test.js` and
  `queueinstall.test.js` expect the credit in the params now.
- `docs/signing.md`: a "Which source's app it is" item under Re-sign All.

## Tried and dropped

- Sending the credit on a marked app's Re-sign (`resignApp` with a url): `installOnDevice` gives the insecure-link
  prompt no url when `params` is set (B104), so that path would lose the prompt. Left out; a marked app's Re-sign
  signs without a credit and goes by its record, as before.

## Not verified

- On a phone: no Lite-app install of RyukGram was run (needs the iPhone 15 / a signing setup and both sources added).
  The Swift side is checked by `native/test_sideload.py` (compiles `native/sign/` on Linux) and the gate's builds;
  the bridge round trip (page → `credit` param → record → `signing.installed`) is not exercised end to end.
- Whether the user's existing copy gets fixed by `urlCredit` depends on RyukGram's source still offering the IPA URL
  it was signed from and AppTesters' entry not offering the same one; not checked against the real sources.
- Install from a source's page outside the queue (the website's in-browser signing, `signAndInstall`) sends no credit;
  the website has no shell record, so it goes by the Installed record as before.
