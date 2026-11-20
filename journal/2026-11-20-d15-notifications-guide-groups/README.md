# D15: Notifications guide matches developer-account.md step 3

Home > User Guides > Notifications for Signed Apps (`web/app/screens/guides.js`, route `guides/keep-bundle-id`) now
follows docs/developer-account.md step 3 (confirmed with Unbound on 2026-11-20):

- Intro: the profile needs Push, App Groups and two notification capabilities (it used to say "only needs Push").
- Step 1 "Make an App ID with Push": tick Push, App Groups, Communication Notifications and Time Sensitive
  Notifications (Associated Domains too); the signing-service extras (App Attest, Fonts, Extended Virtual Addressing,
  Increased Memory Limit, Increased Debugging Memory Limit, WeatherKit on the App Services tab). The API key route
  note now says Apple's API can't make groups or turn on the two notification capabilities.
- New step 2 "Give It App Groups": make group.<App ID>.1 to .5 and assign them via Configure; why (empty group list,
  extension-based notifications get nothing).
- New last step "When the App ID Changes": every profile made from it goes invalid: remake, import into
  Settings > Signing, re-sign.

Tests: `guides.test.js` step title list updated; new D15 test checks each of the above.

Screenshot: `guide.png` (headless Chromium, 390 px wide @2x, iPhone user agent so the site doesn't show its
"not an iPhone" page; a first try without the UA captured that page).

Note: step ticks are stored by step number, so a viewer who had ticked steps 2-5 before sees them shifted by one.
That's acceptable for a checklist guide; no migration.

## Not verified

- Not looked at in the sideload app on a phone: the step text goes through `pageName`, which the existing C15 test
  covers for the "Settings > Installation & Signing" wording, and nothing here is mode-specific.
- Apple's website labels (e.g. "Configure", the App Services tab) are taken from docs/developer-account.md, not
  re-checked on developer.apple.com in this session (needs the user's Apple account).
