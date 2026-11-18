# F85: Version History's Install and Custom Install through the queue

## What changed
- `altstore.js` `appPageAction` and `appPageCustom` take a `version` option, passed to `core/appqueue.js appJob`.
  With a `version`, `appPageAction` queues that version and opens Confirm without the Modify sheet. Queuing it
  replaces any version of the app already queued, as Cydia's marks do. Decision: Modify's choices (Clear and the
  newest's verb) are about the newest version, so on a row for some other version they would be confusing.
- `browse.js renderVersions` (the ipa branch): a row's Install queues that version (`appPageAction` with `version`),
  and Custom Install goes through `appPageCustom` with `version`, so its sheet's Install queues that version with its
  options.
  - In the sideload app, where Custom Install is offered (`localSigning() && !ipaInstallAvailable()`, the same test
    `installRows` uses), a tap opens the sheet: Install, Custom Install, Download IPA. Before, `signIfReady` signed
    straight away there, so Custom Install could never be reached from Version History.
  - Elsewhere a tap queues the version in one go when the queue applies (the website with a certificate). Otherwise
    it does what it did before (`signIfReady`, then the sheet). The jailbreak build is unchanged.
  - The sheet's rows now get the app's name (`installRows`' `name`) for the signing HUD.
- Test: `web/app/screens/versionqueue.test.js`.

## Not verified
- Not run on a phone or in a browser: no device or UI driving was asked for in this task. The DOM path in
  `renderVersions` was checked only with `node --check`. The queue logic it calls is covered by unit tests.
- If two versions share a version string (different builds), `appJob` picks the first match by `version`. Version
  History rows are keyed the same way, so this is an existing limit, not something new.
