# D12 Docs audit after the signing work

## What I did

Checked each claim against the code on main (worker/src/apple-relay.js, core/asc.js, screens/devaccount.js,
native/Sources/ASC.swift, native/sign/IPASigner.swift, screens/settings.js `signingLayout`, core/settings.js
SIGNING_GROUPS).

1. **APPLE_RELAY off**: docs/signing.md (Free Apple ID) and worker/README.md now say only `/apple/status` and the
   free-Apple-ID hosts are 404 when it's off; the App Store Connect pass-through
   (`/apple/api.appstoreconnect.apple.com/v1/{devices,certificates,bundleIds,bundleIdCapabilities,profiles}`, with
   Authorization and DELETE for that host only) works either way. worker/README's route table gained `/apple/status`
   and `/apple/<host>/<path>`; README's worker table gained `/apple/*`.
2. **Own provisioning profiles**: new docs/signing.md section (where the group is, Add API Key / Check Account /
   Remove API Key / Profiles Made by iFizBox, the sign-time steps and remake rules, the app's Keychain + bridge
   calls, the website's localStorage + pass-through, what leaves, tests). Only what is on main: Make Certificate
   (core/asc.js `makeOwnSigning`, `newCertificate`) has no UI yet (F276 open), so it isn't described. Short pointers
   added in signing.md's "Setting it up", "What leaves the phone" and the website's "What leaves the browser",
   developer-account.md step 6, sideload.md's "What iFizBox does" and README's Sideload app section.
3. **Settings paths**: sideload-build mentions now say Settings > Installation & Signing (signing.md, sideload.md,
   developer-account.md, worker/README.md, README's Signing Server section and table, and the image alt texts that
   show the sideload page). Website mentions keep Settings > Signing. sideload.md's "Settings > Installation > This
   iPhone" lines point at Installation & Signing.
4. **Skim**: docs/settings.md's Signing table still had Remove Certificate as its own group (B118 moved it into the
   Certificate row) and lacked the Apple Developer Account group: both fixed. sideload.md's Feather section said
   "iFizBox doesn't make [free profiles]: it doesn't log in to Apple", untrue since the website's free route: now
   says Feather, with a pointer. docs/native.md had nothing touched by these merges.

No signing service is named; no task IDs in the docs.

## Tried and failed

Nothing.

## Not verified

- The UI text in the new section (row names, footer) is read from devaccount.js, not seen on a phone or in a browser:
  the unattended run has no API key and drives no phone.
- `docs/img/crop-signing-server.png` wasn't retaken: it still shows the page titled "Signing" (checked by eye);
  only its alt text changed. Filed as D13 (low).
