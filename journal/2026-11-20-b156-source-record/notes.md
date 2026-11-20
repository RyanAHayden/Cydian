# B156: Installed tab: an app installed from a source shows as "No source lists it"

## Finding
- The source's OpenTennis entry and its IPA agree: the live FIZL0 source lists `io.github.fizl0.hst`, and the 1.8.2 IPA's
  Info.plist says `CFBundleIdentifier io.github.fizl0.hst`, `CFBundleDisplayName OpenTennis` (downloaded and read
  by hand). So neither the bundle ID nor B150's `withSourceNames` was at fault.
- The symptom (the row reads "Signed by iFizBox", the page says "No source lists it.", and it sorts after every
  letter) is exactly a `signedOnly` extra row: `withSignatures` found **no Installed record** for the app. B150's
  rename only works when a record exists, so OpenTennis never got one.
- Likely reason, read from the code and not seen on a phone: since B136, the run writes the record only once iOS
  says it has the app (`recordWhen`). A row that ends "Sent to iOS" (unsure) is asked once, when it ends and each
  time iFizBox comes back to the front (`followHandoff`). If iOS answers "no" while it is still installing (the
  icon still loading on the home screen), nobody asks again, and the record is never written. openMX and Party
  Board probably got a "yes" on their check.

## What changed
- `web/app/core/installed.js`: `unrecordedSigned(installed, records)` (signed apps no record stands for) and
  `sourceRecordFor(app, pkgs)`. The shell's signed-app record keeps the IPA's `url` (native SignedRecord.url). A
  catalog package whose app offers that exact download (version or stanza downloadURL, normalized hrefs) gives the
  record: the source's name, sourceName, key, icon, and the signed date. It matches the download, not the bundle ID,
  so B150's RyukGram/Instagram rule holds.
- `web/app/screens/installed.js`: `restoreSourceRecords` runs on each sideload Installed load. It looks up each
  unrecorded signed app's ID (original and signed) on every source and writes the missing record.
  recordInstall's onAppsChange then draws the list again, with the app under its letter and its source.
- `web/app/screens/apprun.js` `followHandoff`: a "no" from iOS is asked again every 5 s, up to 12 times, while
  iFizBox is in front. `stop()` (page close) cancels it. Timers are unref'd, so node tests don't hang. This fixes
  the cause going forward. The Installed fix repairs apps already installed, and any case still missed, such as
  the run page being closed before iOS finishes.

## Checks
- `web/app/core/b156-source-record.test.js`: unrecordedSigned; sourceRecordFor, including the source's name over
  the IPA's, a re-signed ID, the same bundle ID from another IPA (no match), and no/bad URL; restoreSourceRecords
  into a memory store, then appSections puts OpenTennis under O with FIZL0 and it leaves the extra rows; and
  followHandoff's re-ask: it asks again after a "no", stops at the first "yes", stops after `tries`, and stop()
  cancels it.
- Chromium fake bridge (`capture.mjs`, B129's with a `signing.installed` fake reading `SIGNED=signed.json`):
  sideload mode, the FIZL0 source added through Sources > Add, and records seeded for openMX, Party Board and
  YouMod but not OpenTennis. Installed (`installed.png`) shows OpenTennis under O, "FIZL0", with its icon, and the
  store now holds its record. Run: serve `web/app` (python http.server on 127.0.0.1:8871), then
  `SIGNED=signed.json node capture.mjs http://127.0.0.1:8871/ OUT script.json --mode sideload`.

## Tried / odd
- In the first fake-bridge run, the seeded YouMod record was gone by the time Installed loaded. In that run, the
  Add Source flow had landed on Home, not Sources. A second run with the same steps kept it. I couldn't
  reproduce it, so I didn't chase it. If YouMod's record really disappears on the phone, it would be another
  source of "Signed by" rows; see the queued YouMod-icon task.

## Not verified
- Not run on a phone. I have no sideload iPhone with this build, and the iPhone 7 runs the jailbreak build, which
  doesn't use these records. So the root cause (iOS saying "not yet") is inferred from the code, not observed.
- Whether the native signed-app `url` on the user's phone is the source's downloadURL exactly. The queue passes
  `installOptions(...).download` (the source's URL, run through httpUrl), so it should be. If a source sends its
  downloads through redirects, the stored URL is still the one requested, so it still matches.
- An app whose source no longer offers the installed version's URL (the version was dropped from `versions`)
  stays signed-only. That is correct: no source lists that IPA any more.
