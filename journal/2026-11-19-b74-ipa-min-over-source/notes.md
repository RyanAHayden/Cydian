# B74: the IPA's own MinimumOSVersion beats a lower source minOSVersion

YouMod Repo says `minOSVersion: 14.0`; its YouTube IPA's Info.plist says 17.0. The rows and the app page trusted the
source, so a 15.8.8 iPhone got a green check and "Made for iOS 14.0 or later".

## What changed

- `core/ipainfo.js`: `ipaRaises(target, info)`: true when the info was read from the IPA itself (`from: "ipa"`) and
  its minOSVersion is numerically above the source's. `withIpaInfo` then uses the IPA's value (`ipaFrom: "ipa"`);
  otherwise the source still wins (a lower IPA value, or an App Store / description guess, never overrides it).
  The source's maxOSVersion and deviceFamily are kept.
- `core/catalog.js`: no code change needed. `judged` already ran every kept IPA answer through `withIpaInfo`, so the
  rows follow automatically; the header comment now says so. (The brief's "setIpaInfo only fills apps without a source
  value" was because withIpaInfo kept the source's value, and because the app page only asked for apps without one.)
- `screens/altstore.js` renderApp:
  - the kept answer is read for every IPA, and used when the source gives no range (as before) or when `ipaRaises`;
  - the Compatibility row shows the IPA's range ("iOS 17.0 or later (from the app)") when it raises the source's;
  - an app whose source gives a range, with nothing kept, now asks `/api/ipainfo` too (no App Store or description
    fallback: only the IPA's own answer can override). When it raises the range, the Works On tile, the footer and
    the Compatibility row are drawn again and `catalog.setIpaInfo` updates the rows. checkIpa's in-flight map means
    this is the same request as the jailbreak Install row's `markIpaNeeds`, so it isn't asked twice.
  Decision: ask on every opened app page (not only in the jailbreak build), so the website and Lite get the right
  answer too. The Worker caches the answer at the edge and the device keeps it per URL, and only an opened page asks
  (never a list), so the cost stays the same as F160's.
- Tests (`core/ipainfo.test.js`): the old "source wins over the IPA" assertion now checks the B74 rule (lower IPA value
  and guesses lose; a higher IPA value wins). There's a new YouMod-shaped test covering `ipaRaises` and a catalog row
  going from `works` to `ios` after setIpaInfo.

## Tried and failed

Nothing.

## Not verified

- renderApp in a browser or on the iPhone 7: no test renders the AltStore app page (it needs a DOM), and the task
  didn't ask for a phone run. What isn't checked: the Compatibility row's text, the redraw after the async ask, and the
  rows' red X once the page has read the IPA. The pieces under them (`withIpaInfo`, `ipaRaises`, catalog rows) are
  unit-tested, and `node --check` passes on altstore.js.
