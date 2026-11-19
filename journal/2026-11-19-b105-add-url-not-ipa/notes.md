# B105 My IPAs > Add from URL: a link that isn't an IPA fails with an alert

## What changed

- `native/Sources/MyIPAs.swift` `add`: after the download, `Inspect.ipa(tmp)` always runs. If it throws (not a zip,
  no single `Payload/<App>.app/Info.plist`), tmp is deleted and the call fails with
  `not_ipa: That link didn't give an IPA (it may be a web page or another kind of file).` The bridge (native/bridge.js
  `withCode`) strips the code off, so the existing "Couldn't Download" alert (screens/myipas.js addFromUrl, and
  share.js's sign-ipa route) shows the sentence as it is. A link that doesn't end in .ipa takes the name of the
  app inside ("<name> <version>.ipa", the bundle ID when the app has no name); the URL's last path piece is used only
  when it ends in .ipa.
- `web/app/core/ipainstall.js`: `not_ipa` gets a title ("Not an IPA") and a sentence in `ipaError`, next to `bad_url`
  and `bad_ipa`, for any caller that maps a library error through it.
- `web/app/core/myipas.js` `addSiteUrl`: the browser can't look inside the link, so it throws
  "That link doesn't end in .ipa." when `nameFromUrl` is empty and `about.name` names nothing. The `App.ipa`
  fallback is gone. signing-client.js's Too Big path passes `name`, so it keeps working (too-big.test.js passes
  unchanged). A link already kept is still answered as before (the throw comes after the same-link lookup).
- Tests: `web/app/core/myipas.test.js` — the old `get?id=1` -> `App.ipa` line now passes `about.name`; a new test
  refuses `https://example.com/page`, `https://example.com`, a blank or dots-only name, and accepts `.../x.ipa`
  and a no-.ipa link with `about.name`.

No change was needed in screens/myipas.js or signing-client.js: the site's Add already shows "Couldn't Add" with the
thrown message, and the app's Add already shows "Couldn't Download" with deviceError's message.

## Tried and dropped

- Checking it in Chromium with the fake bridge: `native/fake/fake-native.mjs` has no `library.add`, so it would
  only test a stub written for the purpose, not the Swift path.

## Not verified

- On the iPhone 7 (or any phone), adding `https://example.com` in My IPAs: not run. It needs a fresh .deb on the 7
  under the ui-7 lock, and other slots overwrite the 7's .deb mid-test; the Swift change is small and the build
  passes. The alert wiring it relies on (addFromUrl's catch -> "Couldn't Download") was not changed.
- The website's Add alert in a real browser: not clicked; the throw is covered by node tests and the catch that
  shows "Couldn't Add" is existing code.
