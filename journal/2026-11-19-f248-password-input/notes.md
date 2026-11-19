# F248: Certificate import checks for a password; a clearer Password input

## What changed
- `core/certfiles.js` `resolvePassword(p12, saved, guesses)`: the saved password if it opens the .p12, else the first
  guess or `""` that does; `locked` when none does (and nothing saved might). `chooseFiles` (settings.js) uses it:
  a .p12 the empty password opens is saved with `password: ""`, `passwordOk: true`, and goes on as before (it's
  imported in the app, ready on the site). A locked one calls `wantPasswordFocus(el)`: the next Password field
  drawn on that page scrolls into view and takes the focus (`takePasswordFocus`, once).
- The Password row became its own **Password** group under the files (`passwordBlock`): a full-width secure
  field after a state glyph, placeholder `Password for <p12 name>`, then a "Read From a .txt File" button row
  (blue, bold, centred; it replaces the old Browse). The state comes from the pure `passwordState(id, kept)`, shown
  on the glyph and in a short footer:
  waiting (lock, white row with a 2px blue inset ring, "me.p12 is locked. Type the password it was exported
  with."), wrong (red x, bold red "Wrong password." + "It doesn't open me.p12."), right (green check, "Opens
  me.p12."), not needed (green check, grey "Not Needed" placeholder, read-only field, "me.p12 has no
  password."), Keychain-held (grey lock, "Not Kept"), plus `none` (no .p12 yet: "Required", no footer) and
  `unchecked` (typed, but this .p12 can't be checked here: no verdict).
- The long footer no longer gets the password sentence appended; `recheckPassword` and `importIfComplete`
  (typing) repaint the new group's state instead (`showPasswordState`).
- account.js and the signing sheets (signing-sheet.js, myipas.js) don't use the Password row: nothing to change there.
- Native: `native/Sources/FocusKeyboard.swift` swizzles WKContentView's
  `_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:` (falls back to iOS 12's
  `changingActivityState:` name) to pass `userIsInteracting = true`: a focus from script brings up the keyboard
  (Cordova's KeyboardDisplayRequiresUserAction=false approach). Called from `Web.make`, so both builds. The
  website can only place the caret (iOS opens the keyboard only on a tap).
  Side effect, wanted: My IPAs' search, which focuses its field after the push, now gets the keyboard too.
- Fixture `web/app/core/fixtures/signing/test-nopass.p12`: a self-signed test key and cert exported with an empty
  password (`openssl pkcs12 -export -passout pass:`).

## Checks
- `node --test`: `core/certpassword.test.js` (the no-password fixture gets `passwordOk: true`, `password: ""`; the
  locked one is `locked`), `screens/signing-password.test.js` (every state's glyph, placeholder and footer; the focus
  is taken once, only on the page that asked).
- Renders: `shots.mjs` + `gen.mjs` here (headless Chromium, 402x874 @3x, the website with web/app served as the
  root: the router rewrites to root paths, so serve `web/app` itself). Every state in light and dark, plus two
  **real picks** through the Import row's file input (CDP `DOM.setFileInputFiles`): test.p12 left
  `document.activeElement` = the Password field in the waiting state; test-nopass.p12 saved
  `{password: "", passwordOk: true}` and showed Not Needed. Kept: waiting-light, wrong-dark, notneeded-light,
  right-dark.
- First gate run failed: dark rules with fixed colours (#ff5b4f, #4cc73d) broke the "every dark rule paints with
  tokens" test; they're `--dk-pw-red` / `--dk-pw-green` in the dark block now.
- Tried first: serving the repo root and opening /web/app/: the router replaced the URL with `/` and every shot was
  a directory listing.

## Not verified
- **The keyboard coming up on the iPhone 7 (iOS 15) and current iOS**: the phone check (sideload build, pick a
  locked .p12) needs someone to pick a file in the iOS Files picker, and this run is unattended. The sideload build
  isn't on the 7 either (it runs the .deb), and nobody is here to install it. The swizzle builds (the gate's native
  build), but whether WebKit on iOS 15.8 and on 26 still has that selector, and starts the input session, is unchecked
  on a device. If the selector is missing, `enable()` does nothing and iOS's own rule stays (caret only, no crash).
- The Keychain-held state (`kept`) as a render: the site has no Keychain and the capture tool's fake bridge only
  plays the jailbreak build. `passwordState` covers it in the unit test.
- A render of the walkthrough (How Signing Works) with the new group: its CSS shows the Password header there
  (`.walk-body .sign-files .sign-password > .group-header`), but I didn't render it.
