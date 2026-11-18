# F77: My IPAs, your own IPAs under Installed

## What I did

- **Native library** (`native/sign/Library.swift`, `IPALibrary`): the IPAs are files in Documents, and the cache,
  options and signed copies live in Application Support/MyIPAs. A signed copy counts only while the IPA file (size
  and date), the certificate (SHA-1), the Sign Options and the expiry all still fit, so the state is never stale.
  It also has safe file names (no folders, no dots, ".ipa"), unique names ("Name 2.ipa"), delete, and a sweep of
  leftovers when an IPA is deleted in Files.
- **Bridge** (`native/Sources/MyIPAs.swift`): `library.list/add/pick/options/sign/install/export/delete`,
  registered from `SignBridge.register`. Browse is `UIDocumentPickerViewController` (asCopy, more than one at once).
  Save Signed IPA is `UIActivityViewController` on a copy named "<App> <version> (signed).ipa". The list's icons go
  through UIKit (`smallPNG`), which decodes Apple's CgBI PNGs, and are saved as plain 120×120 PNGs.
- **Sideload.swift**: I split `serveAndOpen` (serve, record, open the itms link) out of `signAndOpen`, so an IPA that
  is already signed installs without signing again. Re-sign All signs records with `library:<file>` URLs from the
  library's file.
- **Other apps' .ipa (N9's part)**: `Incoming.receive` (App.swift) hands file URLs ending in .ipa to
  `MyIPAs.receive`. That copies the file in (or moves iOS's Inbox copy, or just opens a file already in Documents)
  and passes on `cydian://myipas?file=` (a new host in `IncomingLink`). `incoming.js` then opens the IPA's page.
- **Info-sideload.plist**: `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` (Documents shows in Files).
- **Web**: `core/myipas.js` (states, rows, sizes, link names, Sign Options params, the website's localStorage list),
  `screens/myipas.js` (list, IPA page, Sign Options page), `myipas.css`, the "My IPAs" row in Installed under
  "Your Own IPAs", and `signing-client.js` `installFromLibrary` + `serverReachable` + `libraryCall`.
- Installing records the app in Installed (F30) with sourceName "My IPAs" and the IPA's icon as a data: URL. The
  website uses the Signing Server's answer (bundleId, name, version).
- Docs: `docs/signing.md` "My IPAs (F77)".

## Decisions (unattended, so written down)

- **library.\* instead of a `file` param on signing.install/inspect.** The brief says "reuse signing.\*, adding a
  local-file path". The library has to remember the signed copy, its options and its state, which signing.install's
  one-shot token flow doesn't. So the new calls share the signer, `Sideload.ready/takeServer/serveAndOpen` and the
  error codes rather than taking a new parameter on the old ones.
- **Offline**: Install always signs first (no network needed), then checks `<server>/sign/status` (6 s). If that
  doesn't answer it shows "No Connection", explains that the Signing Server hands iOS the manifest, and keeps the
  signed copy (the state reads "Signed, ready to install").
- **Sign Options are a page** (pushed, Save in the nav bar) rather than F68's sheet, because they are kept per IPA
  and apply to Sign Now too. Changing them drops a signed copy made with the old ones.
- **Website**: Add is From URL only, kept in localStorage (`cydian.myIpas`), Install = `signAndInstall`. There is
  no Sign Options page (`signBody` takes only the URL) and the state reads "Signed by the Signing Server on Install".
- The My IPAs row sits under the app list in its own section ("Your Own IPAs"), like the site's "Jailbroken
  iPhone" row, so F30's row indexes (delete controls) are unchanged.

## Tried and failed

- `files()` first sorted with `localizedStandardCompare` on whole names. On Linux "Rich 2.ipa" came before
  "Rich.ipa" (space < "."), so the sort now compares names without ".ipa".

## Tests

- Swift (`native/sign/tests/main.swift`, "F77: My IPAs signs a local IPA file"): adds IPAs, unique names, details,
  an unreadable zip listed with an error, signs the local file and verifies the signature, checks the original stays
  as added, and that another certificate, no certificate, changed options, expiry and a replaced file each count as
  not signed. Also delete and sweep. `IncomingLink` accepts `cydian://myipas` (sideload tests).
- Node: `core/myipas.test.js` (states, rows, sizes, names, options, website list), `screens/myipas.test.js` (routes,
  incoming link), `screens/installed.test.js` (pageKind, row), `signing-client-library.test.js` (offline keeps
  the signed copy, online installs with the manifest server, error codes, walkthrough first).
- The native builds (deb + IPA) compile with MyIPAs.swift through `tools/check.sh`.

## Not verified

- **On an iPhone: nothing.** Browse (the Files picker), From URL, Save Signed IPA (share sheet), Documents showing
  in Files, an .ipa opened from another app, and a real install from a signed copy all need the user's iPhone with
  the sideload build. The brief leaves that to the user, and no agent session can drive that phone.
- The look of the new pages hasn't been rendered or compared with the kit at 3x. They reuse the package page's
  header, grouped/plain tables and the sign sheet's field styles; only the centred red Delete row is new CSS.
- `UIImage` decoding CgBI icons (`smallPNG`) is iOS-only. On Linux the test library keeps the raw PNG.
- `LSSupportsOpeningDocumentsInPlace` changes how iOS hands over the .p12/.mobileprovision document types too
  (in place, security-scoped). Nothing in the app handled those file URLs before (Incoming took only cydian://
  links), so nothing should break, but it hasn't been tried on a phone.
