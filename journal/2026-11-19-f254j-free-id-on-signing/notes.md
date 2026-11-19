# F254j: Use a Free Apple ID on Settings > Signing

## What I did
- `core/settings.js` SIGNING_GROUPS gains `free` (after `other`, before `remove`).
- `screens/settings.js` signingLayout(): `free` on the website while no certificate is set (`site && !certificate`;
  a half-picked import still counts as none). drawSiteSigning's parts draw it with `freeRouteBlock()` from
  screens/free-apple-id.js, the same group How Signing Works ends with. It stays hidden unless the Worker's Apple
  relay answers `/apple/status` with on, as on the walkthrough. Its flow state is module-level, so the page's
  redraws keep the open view.
- settings.test.js: the site layout now includes `free`; never in the sideload/jailbreak layouts.
- docs/settings.md: the group's row in the Signing table.

## Checked
- node tests for settings, signing-b94 and free-apple-id pass.
- Headless Chromium with an iPhone UA against a stub server (static web/app plus `/apple/status` -> `{"on":true}`):
  Settings > Signing shows Certificate, Keep Bundle IDs, **Free Apple ID / Use a Free Apple ID** with its footer,
  How Signing Works, Share Your Certificate. (A desktop UA gets the "Open on Your iPhone" page instead.)

## Not verified
- Tapping through the flow from this page (sign-in, setup) on a real iPhone: it needs a live relay and an Apple ID;
  the flow code is unchanged and was checked in F254/F254i from How Signing Works.
- That the group disappears once a certificate is imported in the same session: covered by signingLayout's test
  and the page redraw on import, not watched in a browser.
