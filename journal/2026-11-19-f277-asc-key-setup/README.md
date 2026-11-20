# F277 Own profiles: setup for new users

## What changed

1. **Guide** `asc-key` in `web/app/screens/guides.js` ("API Key", "How to make an API key"): five ticking steps
   (Users and Access > Integrations > App Store Connect API > Team Keys and the first-time Request Access; + with
   Access: Admin; the one-time download of `AuthKey_<Key ID>.p8`; Copy the Issuer ID above the keys, or keep it in a
   .txt beside the .p8; Add API Key). `only: "link"`, `linked: true`: it opens from a link in any mode and is listed
   in no User Guides list (so Home's lists and their tests stay as they are). The Apple Developer Account group's
   footer gets a link to it (`screens/devaccount.js accountGroup`, `.asc-guide-link`).
2. **Issuer ID without retyping**
   - `core/certfiles.js sortKeyFiles(files, { unzip })`: the .p8 (found by its PEM, any name), the Key ID from
     `AuthKey_<id>.p8` (`core/asc.js keyIdFromName`) or a "Key ID:" line in a note, and the Issuer ID from a
     .txt/.md/no-extension note (an "Issuer"-labelled UUID first), `.zip` entries and `__MACOSX` litter handled as
     `sortCertFiles` does. `issuerFromText`, `UUID_RE`.
   - Add API Key's picker is `multiple`, accepts `.p8,.txt,.zip`.
   - The Issuer ID alert is prefilled from the .txt; without one, `prefillField` fills it from `issuerPrefill` once the
     clipboard answers (only while the field is empty, untouched and on screen), and the field has a Paste button that
     takes the UUID out of whatever was copied. A value that isn't a UUID is refused before asking Apple.
   - `issuerPrefill`: the app calls the shell's `clipboard.read {}` (not `auto: true`: the sideload build's auto read
     only takes copied web URLs, so a UUID would never come through). Decision: the website reads
     `navigator.clipboard.readText()` only when `navigator.permissions.query({name: "clipboard-read"})` says
     `granted` (Chromium). Safari can't answer that query, and an unasked read there raises its Paste bubble, which
     `screens/sources.js` already avoids on purpose; the Paste button covers Safari.
3. **UDID through the website, from the app**: when Check Account (app only) ends with this iPhone unknown
   (`udidUnknown`: no UDID, and the line doesn't say it's in the account), its alert adds **Find UDID**.
   `findUdidViaSite` POSTs `https://<DOMAIN>/sign/udid` (`screens/signing.js startUdid`, the Worker's CORS is `*`),
   opens the profile URL with `app.openURL` (else shows the link), and `watchUdid` polls; on done `registerUdid` hands
   the UDID to the shell (new `device.udid.set` in `native/Sources/PhoneID.swift`, kept like a paired UDID so sign-time
   `ASC.swift` uses it) and registers it with `deviceLine`. Check Account also reads `storedUdid()` in the app, so an
   older shell without `device.udid.set` still knows the UDID.
4. Tests: `screens/devaccount.test.js` (file sorting, zip, labels, clipboard prefill in app and site, no fill over
   typing, udidUnknown, the visit flow with a fake fetcher/store/watcher, older shell) and one guide test in
   `screens/guides.test.js`. `docs/signing.md` updated.

## Tried and dropped

- A sed one-liner to add the PhoneID.swift header line failed to parse (the `|` in the text); done with the editor.

## Not verified

- On a phone: none of it was run on a device (the task didn't ask for the iPhone 7, and the iPhone 15 is read only).
  In particular: whether the sideload build's `clipboard.read {}` raises iOS's Allow Paste alert when the Issuer ID
  alert opens (expected once per copy on iOS 16+), whether WKWebView's `fetch` to `https://<DOMAIN>/sign/udid` works
  from the app's page origin (the Worker answers CORS `*`, but the app's own CSP/scheme wasn't tested), and whether
  Safari, after the profile is installed, leaves the user a clear way back to the app (the done page says to go back).
- The native build: `device.udid.set` compiles only where `tools/check.sh` finds the Swift toolchain; see the gate
  output in the `done` run.
- The guide's App Store Connect wording (Request Access, Team Keys, Access: Admin) is from the task's brief and
  Apple's current layout as known, not re-checked on the live site.
- The footer link's look (a plain link in the grey footer text) wasn't rendered in a browser.
