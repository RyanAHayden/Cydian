# B229: Install IPAs row stays Not Installed / Not signed after a row install (Lite, iOS 27)

## What was wrong

Two separate causes, plus one part that is working as designed.

1. **Not Installed: iOS 27's `applicationIsInstalled:` says false for every app.** I asked the live app on the
   iPhone 15 Pro (iOS 27.0.1, 0.18.0) over the web inspector (`pymobiledevice3 webinspector cdp`, a
   `Runtime.evaluate` of `ifizboxNative.call("apps.isInstalled", …)`). The answer was `false` for all nine IDs:
   openMX, OpenTennis, PartyBoard, the probes, WDA, `com.apple.mobilesafari`, and **`com.ryha.ifizbox` itself**.
   The private call is still there, so `Workspace.isInstalled` returned a definite `false`. My IPAs'
   `installedOf` trusts a boolean answer over every record, so the row stayed under Not Installed.
   The same false also reached the native side: `forgetUnlessInstalled` (B136) could drop the shell's own signed
   record, `installedAppID` (B138) skipped it, and the install watch ended on false instead of "can't tell".
2. **Not signed: a row install signs into a throwaway copy.** A row's SIGN → INSTALL goes through the IPA queue
   (F241 `queueLibraryInstall`, `signing.prepare {library}` in `SignAhead.swift`). That signs the library file into
   `…-ahead.ipa` for the queue, and never writes My IPAs' signed copy. The first SIGN tap only arms INSTALL
   (`priceTap`); it doesn't sign. So "Not signed" was literally true: the library had no signed copy.
3. **The progress page closing by itself is B175** (`screens/apprun.js` / `incoming.js`): a finished run's page
   closes when iFizBox comes back to the front. That is by design, so nothing changed there.

## What I changed

- `native/Sources/Sideload.swift`: `Workspace.seesInstalls` asks `applicationIsInstalled:` once per launch with
  iFizBox's own bundle ID. If even that comes back false, `isInstalled` answers nil ("can't tell") for every ID.
  That fixes every caller at once: `apps.isInstalled`/`signing.isInstalled` answer null, so the page goes by
  records. B136's forget keeps the record, and the watch ends "Sent to iOS" instead of false. Phones where the call
  works (iOS 15 jailbreak, older sideload phones) see iFizBox as installed, so they behave as before.
- `web/app/screens/myipas.js` `installedOf`: in the sideload app, an ID with no boolean answer that Installed's records
  don't cover also counts when the shell's own signed record has that bundle ID (`signing.installed`). This record
  is written when iOS is handed the IPA. It's needed because the queue writes Installed's record only after iOS
  confirms the install (B136 `recordWhen`), and on iOS 27 that never happens.
- `native/sign/Library.swift` `IPALibrary.keepSigned`, called from `SignAhead.prepare` for `{library}` jobs: the
  queue's signed IPA is copied in as the file's signed copy (same `Signed` metadata as `library.sign`). This only
  happens when it was signed with the options a sign in My IPAs would use (`options(_:keep:)`, the global Keep Bundle
  IDs included). Otherwise it's left alone, so the copy always counts the way `library.list` checks it.
- `myipas.js`: on `visibilitychange` (back from iOS's prompt), the library list is fetched again along with the
  installed map, and the list is redrawn only if something changed. That way the kept signed copy shows without
  leaving the page.

- Spec review: the signed-record fallback now also matches `originalBundleId`. This covers an old-way copy (Keep
  Bundle IDs off), which is installed under the profile's ID while the row asks by the IPA's own ID. The review
  also flagged that `seesInstalls` is worked out once per launch. That's harmless: when the workspace isn't there,
  every `isInstalled` call answers nil anyway.

## Tests

- `web/app/screens/myipas-b229.test.js`: covers the signed-record fallback, when it is asked (only after Installed's
  records, once), iOS's false still winning, jailbreak mode and a failing call asking nothing more, and the default
  bridge call.
- `native/sign/tests/main.swift` "B229: My IPAs keeps the queue's signed copy": other options aren't kept, the IPA's
  own options are kept and count as signed, the queue's file stays in place, and a Keep Bundle IDs mismatch doesn't
  count.

## Tried and failed

- nothing

## Not verified

- **A real row install on the iPhone 15 Pro with this build.** B227 held the iPhone 15 UI lock for this whole
  session, and installing a new Lite build plus driving SIGN → INSTALL would have run into its work. I only read
  from the running 0.18.0 app over the web inspector (no taps). Still to check on the phone: after a row install
  the row moves to Installed with OPEN and reads "Signed", and the progress log says "Kept the signed copy in My
  IPAs".
- **The self-probe on the iPhone 7 (iOS 15 jailbreak).** I didn't touch it, because this task doesn't say to.
  `applicationIsInstalled:` on iFizBox's own ID should be true there, which keeps the old behaviour. If it isn't,
  the jailbreak build falls back to Installed's records, which is the existing path for a null answer.
- A Cancel on iOS's install prompt on iOS 27 now leaves the shell's signed record in place (B136 can't tell that iOS
  never took the app). So such a row may read Installed until the user removes it. Before this change, the same
  phone showed every app as not installed, so this is the lesser error.
