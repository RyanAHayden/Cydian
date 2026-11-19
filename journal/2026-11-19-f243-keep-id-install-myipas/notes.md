# F243: Keep Bundle IDs on plain Install and My IPAs

## What changed

- **Plain Install warns once about the original** (`web/app/signing-client.js originalWarning`). In the sideload
  app's `signAndInstall`, after the walkthrough check and before signing: if Keep Bundle IDs is on, the bundle ID is
  known, it isn't iFizBox, and `core/keepid.js originalState` says the ID is installed but not signed by iFizBox, an
  alert "Delete the Original First?" shows `originalNote`'s text with Cancel / Install a Copy / Install.
  - Install goes on and is remembered per bundle ID (`localStorage ifizbox.originalWarned`, last 200), so the next
    Install of that app doesn't ask. Why it's remembered: the copy on the phone may not be an App Store one (e.g.
    another sideloader's), and then the warning is noise after the first time.
  - Install a Copy signs that one install the old way (`params: { url, keepBundleId: false }`), beside the original.
    Not remembered, nor is Cancel.
  - `screens/browse.js signIfReady` now passes `bundleId: app.bundleIdentifier` (one line, outside the task's file
    list) so the check can run; without a bundle ID it says nothing (it can't know the ID before downloading).
- **My IPAs' Sign Options has a Keep Bundle ID switch** (`screens/myipas.js renderOptions`): starts as the IPA's saved
  choice (`keepStart`), else Settings > Signing's; turning it off shows `OLD_WAY_ALERT` first, as Custom Install does;
  the footer (`keepFooter`) gives the old-way text, the original-on-the-phone note (when the ID is kept and no other ID
  is typed), or what keeping does. Save sends `keepBundleId` as it stands. "Changed" on the IPA page counts a saved
  Off too.
- **My IPAs' offline Sign follows the global setting**:
  - `IPALibrary.hasOptions` / `options(_:keep:)`: with no `.options.json` the `keep` sent by the page decides (nil:
    on); with one, its own value (nil in a pre-F237 file = the old way, unchanged).
  - `signed(..., keep:)`, `sign(..., keep:)`, `json(..., keep:)`: a copy signed the other way no longer counts, so
    flipping the setting re-signs on the next Sign/Install. `json`'s `options.keepBundleId` is `null` without saved
    options.
  - `MyIPAs.swift`: `keep(c)` reads `keepBundleId` from every library call's params and passes it to list, sign,
    install, export, unsign, delete, add, pick.
  - `signing-client.js libraryCall` adds `withKeep` to every call except `options` (which sends the page's switch).
  - `core/appqueue.js libraryJob` (one line, outside the list): sends a saved switch as it is (true too), null leaves
    it to the global setting. Before, `true` meant "nothing saved", so a saved On was overridden by a global Off.
    `core/keepid.test.js`'s F237 assertion changed to match.
- Docs: `docs/signing.md` "Keep Bundle IDs".
- Follow-up filed: **F246**, the same warning on the IPA queue's Install (the app page in the sideload app queues
  via `appPageAction`, so `signAndInstall` is mostly its fallback path).

## Decisions

- Saving Sign Options pins the switch (no "follow the setting" third state): every save already wrote
  `keepBundleID: true` before this task (`SignOptions(json:)` defaults it), so a tri-state would need a new stored
  field in `SignedRecord.StoredOptions` (CertCheck.swift, shared with records). The footer says the setting decides
  for IPAs without Sign Options.
- Warning only with Keep Bundle IDs on: the old way installs a copy beside the original and replaces nothing.

## Tests

- `web/app/signing-client-original.test.js`: the alert, remembered once, Cancel/Copy not remembered, every no-op case,
  a failing bridge, `libraryCall` adding `keepBundleId: false` except for options.
- `web/app/screens/myipas-keep.test.js`: `keepStart`, `keepFooter`, `libraryJob` / `prepareParams` carrying it.
- `native/sign/tests/main.swift` "F243: My IPAs' Sign follows Keep Bundle IDs": null without options, the setting
  deciding, a copy signed Off not counting when On, saved options winning. `python3 -m unittest native.test_sign`
  passed with the Swift toolchain.
- The whole `node --test web/app` showed one failure, the F237 libraryJob assertion above, which was updated.

## Not verified

- Not run on the iPhone 7: the task didn't ask for phone testing, and the shared `.deb` there is overwritten by other
  slots. So the alert, the Sign Options switch's look, and a real offline Sign with the setting Off are checked only
  by unit tests and the native build.
- `signAndInstall` from start to finish (walkthrough check, then the warning, then `installOnDevice` with
  `keepBundleId: false` for Install a Copy) isn't tested as one piece: `firstInstallCheck` needs the server and status
  fakes no test has set up yet. `originalWarning` is tested alone, and the wiring is three lines.
- Whether iOS really refuses a signed app over another sideloader's copy (not App Store) wasn't checked. The once-only
  memory is there so that case doesn't keep asking.
