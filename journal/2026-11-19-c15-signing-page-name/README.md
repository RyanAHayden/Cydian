# C15: the sideload build names its signing page Installation & Signing

## What I did

- New `web/app/core/signingpage.js`: `signingPage(mode)` ("Settings > Installation & Signing" in the sideload
  build, else "Settings > Signing") and `pageName(text, mode)` (swaps the old name inside a text). Mode defaults to
  the bridge's own `ifizboxNative.mode`; the module has no imports so `core/signing.js` can use it without a cycle
  (core/settings.js → keepid → websign → signing).
- `screens/guides.js`: FAQ answers and steps, the Notifications guide's steps and rows, and Next rows (`linkRow`)
  go through `pageName` when drawn. The data stays one text, so the website and jailbreak app read as before.
- `screens/altstore.js`: the sideload Install footer (the `localSigning()` branch). `SITE_INSTALL_FOOTER` is the
  website's and keeps "Settings > Signing".
- `screens/myipas.js`: the IPA page's "Add your certificate…" footer and the Sign Options' `keepFooter` (both
  sideload-only). The website's "Kept in this browser…" footer keeps the old name.
- `screens/free-apple-id.js`: the website's Save for the App footer names the *app's* page, and that app is the
  sideload build, so it says Settings > Installation & Signing > Select All Files.
- `signing-client.js`: its "No Certificate" alert is `signInBrowser`'s, which only the website runs, so it stays.
  The sideload build's No Certificate / No Signing Server alerts come from `core/signing.js deviceError` (signing
  calls only the sideload build makes): those three messages now use `signingPage()`. That file was not in the
  brief's list; it is a three-string change plus one import.
- Tests: `web/app/core/signingpage.test.js` (names by mode, matches settings.js `MERGED_TITLE`, deviceError in
  sideload) and one test added to `screens/guides.test.js` (rendered answer, steps, rows in sideload; website keeps
  the old label; hrefs unchanged).

Left alone: `core/freeroute.js`'s "Find This iPhone's UDID first (Settings > Signing)" is the website's free Apple ID
flow, whose page kept its name.

## Not verified

- Not looked at on a phone or in a sideload build: the change is text only and the tests set
  `ifizboxNative.mode = "sideload"` to render it. The longer name may wrap one more line in footers; not checked
  visually.
