# B168: Paste in the sign-in fields

## What was broken

- **Settings > Account > Sign In With Key** (the iFizBox sign-in): its alert passes `input: { paste: true }`. The
  alert's Paste button (nav/alert.js) called `input.paste(text)`, and `true` isn't a function, so every tap threw
  a TypeError inside the click handler (an unhandled rejection) and the field stayed empty: in the app (after the
  bridge's `clipboard.read` had already answered) and on the website alike. Every other `paste:` caller passes a
  function, which is why Enter APT URL, Install from URL and the Issuer ID's Paste worked.
- **Holding a field for iOS's own Paste**: `style.css` puts `-webkit-user-select: none; -webkit-touch-callout: none`
  on `body`, and inputs inherit it. `input.sign-value` and `.alert-field` already set `user-select: text`, but
  nothing gave fields their callout back.

## What changed

- `web/app/nav/alert.js`: a `paste` that isn't a function pastes the copied text as it is, trimmed ("" leaves the
  field alone, as before). Fixed in the alert, not only in account.js, so any later `paste: true` works too.
- `web/app/style.css`: one new rule after `button`: text inputs and textareas get `user-select: text` and
  `-webkit-touch-callout: default` (checkbox, radio, range and file inputs left out).
- `web/app/nav/alert-paste.test.js`: `paste: true` through the fake bridge (one `clipboard.read`, no Safari read,
  text trimmed), on the website (navigator.clipboard), nothing copied, and the CSS rule.

## The fields checked

- iFizBox Account Sign In With Key: the bug above, fixed.
- Free Apple ID sign-in (screens/free-apple-id.js: Apple ID, Password, the code): plain `input.sign-value` fields
  with no Paste button and no handler that cancels a hold; long-press Paste depends only on the CSS (now explicit).
  No code change there.
- App Store Connect key, Issuer ID (screens/devaccount.js): alert with a `paste` function; worked already, same path
  as the fixed one.
- Certificate password (settings.js `.sign-pw-input`, an `input.sign-value`): long-press only, covered by the CSS.
- Tailscale Sign In (installroute.js): `tailscale.signIn` on the native side opens Tailscale's login page; there is no
  field in iFizBox's web view to paste into.
- `nav/menu.js nativePaste` was fine and needed no change (alert.js keeps its own inline copy so it has no imports).

## Not verified

- On a phone: the sideload build's long-press Paste and the Paste button in the real WKWebView. No phone test in
  this run (the 7 runs the jailbreak build; the task's own test route is the fake bridge, done in node). Whether
  `-webkit-touch-callout: none` alone hid the callout in fields on iOS 16+ is from WebKit's behaviour as I know it,
  not observed; the new rule is harmless either way.
- The rendered page in a browser (no Chromium run): the change is one CSS rule and one line of JS covered by tests.
