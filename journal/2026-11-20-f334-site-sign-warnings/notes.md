# F334: website signing warnings

## What changed

- `web/app/core/keepid.js`: the one-app note now says each app keeps its own keychain and only the profile's App
  Groups folders are shared (B227). New pure helpers: `siteSigned` / `rememberSiteSigned` (team + App ID per
  Info.plist bundle ID, localStorage `ifizbox.siteSigned`), `resignNote` (the other-team / other-App-ID warning),
  `installWarningText` (the job's `warnings` as one message), titles and buttons.
- `web/app/signing/browser.js` (`signInBrowser`; the task named `signing-client.js`, which since C28 only re-exports
  `signing/`): a `signingTarget` helper reads team + App ID from the profile that will sign. Before the worker runs,
  when the app's ID is known: "Signed Before Under Another ID" (Cancel / Sign Anyway). After signing, before the
  upload: "Before You Install" (Cancel / Install) with the job's warnings, plus the other-ID warning for an IPA whose
  ID only the job knew. Cancel drops the early link and uploads nothing. The record is written after the upload
  succeeds, so a cancelled or failed install doesn't change it.
- `docs/signing.md`: both alerts in the website's Install steps; the shared-keychain wording fixed.

Why the record is the entitlements' App ID (`signingIds(...).entitlementsId`) plus team: iOS compares the
`application-identifier` (TEAM.<App ID>) of an update with the installed copy's and refuses a change.

## Checks

- `node --test web/app/core/keepid.test.js`: the reworded note, the record round trip, each resignNote wording, the
  warning message, and two `signInBrowser` runs (job warnings before Install, Cancel uploads nothing; other team
  asked before signing, Cancel signs nothing; ID only known after signing asked before the upload).
- The other website signing tests (signing-client*, early-drop, download-cut, install-cancel, memory-limit,
  too-big, siteinstall, myipas-file, module-graph) pass.

## Not verified

- Not run on a real phone's Safari: the alerts over the progress page while iOS's early install prompt is up were
  only checked with the test fakes. No phone task was given, and the website path needs a deploy to try.
- The record only knows apps this browser signed; an app signed on the phone app or in another browser isn't
  checked (by design: the task asked for localStorage).
