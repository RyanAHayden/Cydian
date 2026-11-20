# D11: Notifications guide and signing.md name the API key route's per-app App IDs

F278 (the API key's own profiles, Settings > Signing > Apple Developer Account) is on main, so the docs now say
what that route does to App IDs.

- `web/app/screens/guides.js` STEPS[KEEP_GUIDE] step 1 (Make an App ID with Push): after "An App ID per app only
  keeps apps' keychains and App Groups apart", one sentence: with an API key (Settings > Signing > Apple Developer
  Account) the app makes that per-app App ID and its Ad Hoc profile itself. Put in the step, not KEEP_INTRO, because
  step texts go through `pageName` (the sideload build says Settings > Installation & Signing) and the intro does not.
  The name comes from `NAME`, not spelled.
- `guides.test.js`: new test for the sentence, in both page names.
- `docs/signing.md` Keep Bundle IDs > Notifications: a bullet that the API key route makes one App ID per app (Push
  on, Ad Hoc profile), which only gives each app its own keychain and App Groups; the one Push App ID already covers
  notifications. Points to "Own provisioning profiles".

Nothing failed along the way.

## Not verified

- The guide page was not looked at on a phone or in a browser: a one-sentence text change, covered by the DOM test.
