# F20: repo extras Sileo users expect

Featured banners, paid packages (Sileo Payment Provider API) and Canister cross-repo search.

## What I did
- `web/app/core/featured.js`: parses `sileo-featured.json` (FeaturedBannersView, itemSize `"{263, 148}"`,
  itemCornerRadius, banners `{url, title, package, hideShadow, displayText}`), drops bad entries (non-http images,
  package names dpkg wouldn't take, more than 20), and a store that caches each repo's file (misses too) for 6 h in
  memory and localStorage. `forHome` takes banners round-robin, two per source, twelve at most.
- `web/app/core/payment.js`: the spec as pure functions: `isCommercial`, `parseEndpoint` (https only),
  `buildRequest` for info / user_info / sign_out / package_info / purchase / authorize_download, `authenticateUrl`,
  `parseCallback` (sileo:// and cydian://, host or path form), `parseReply` (error, recovery_url, invalidate),
  a client that forgets credentials on `invalidate`, and a credential store that puts the payment secret in a
  `secure` store (the shell's Keychain) when there is one.
- `web/app/core/canister.js`: search/lookup URLs, result mapping (dedupe per package and repo, http/https alike;
  other architectures last; marks repos the user has), `priceFor` one repo's copy, and a 10-minute cache (50 keys,
  one request per URL at a time; failures not cached).
- `web/app/screens/extras.js` (DOM and transport) plus `web/app/extras.css`, hooked in with one or two lines each:
  - Home: banners above the tiles (and on the Featured page); hidden while Device is Not Jailbroken.
  - A source's page: its banners above the sections.
  - A package page, `cydia::commercial` on a source with a `payment_endpoint`: a Purchase group. Site: Price (from
    Canister's lookup, through the proxy) and "Buy from <vendor host>" (the package's Depiction, else Homepage,
    else the vendor's origin; opens in a new tab). App: price from the vendor, then Sign In / Buy / Download &
    Install / Sign Out.
  - Search: "Other Sources" under the local results: Canister matches from repos the user hasn't added, asked
    450 ms after typing stops (2+ characters, jailbroken device types only). A tap offers Add Source (flat repos)
    and Depiction.
- Tests: `core/featured.test.js`, `core/payment.test.js` (a fake vendor on node:http that speaks the spec and
  records every request), `core/canister.test.js`. Fixtures in `core/fixtures/f20/` are trimmed live answers.
- Filed F57: the shell's half (net.request, device.info, keychain.*, auth.session, paid.install + a helper verb).

## Checks before building (the brief asked)
- Chariz and Havoc match Sileo's spec (live, 2026-11-17): `repo.chariz.com/payment_endpoint` ->
  `https://chariz.com/api/sileo/`, `havoc.app/payment_endpoint` -> `https://havoc.app/api/sileo/`. Both answer
  `GET /info` and `POST /package/<id>/info` in the spec's shape (Havoc: `{"price":"$1.99","purchased":false,
  "available":true}` for com.purdix.muze4). `/authenticate?udid&model` redirects to their own sign-in pages.
  Neither answers a CORS preflight (404), so the page can't call them: the app must go through the shell, and
  the site's proxy is GET-only, so the site shows Canister's price instead of asking the vendor.
  Chariz's `sileo-featured.json` is a 302 to `chariz.com/api/sileo/featured.json` (both fetchers follow it).
- Sign-in callback: the vendors' servers write `sileo://authentication_success?token&payment_secret`; there is no
  documented way to ask for another scheme. The plan is ASWebAuthenticationSession with callbackURLScheme
  "sileo" (catches the URL without registering the scheme, so Sileo isn't hijacked); `parseCallback` also reads
  `cydian://authentication_success` / `cydian://payment/authentication_success` as the brief wanted, for a shell
  that rewrites it or a vendor that accepts a client callback.
- Canister: no published terms or rate limits. docs.canister.me renders client-side and shows none; the API's
  source (github.com/cnstr/api, `crates/api/src/main.rs`) has no limiter; the README says the deployed API is
  under a proprietary licence (we only call it, nothing copied). `api.canister.me/v2/...` now 308s to
  `api.tale.me/v4/canister-services/...` and sends `Access-Control-Allow-Origin: *`. Kept gentle anyway: debounce,
  2+ chars, limit 50, 10-minute cache, credit in the footer. The lookup endpoint left `repository.uri` null for
  Havoc's copies, so `priceFor` falls back to repository id/slug/name.

## Checked
- `node --test web/app`: all pass (featured 7, payment 7, canister 6 among them).
- Local site (Flask on 127.0.0.1, real proxy, real repos) in headless Chromium 390x844@2x over CDP (scratch
  script): Home showed 4 banners (Havoc and Chariz, round-robin) with images; Havoc's page its 20 banners above
  the sections; Muze 4's page "Purchase / Price $1.99 / Buy from havoc.app"; Search "filza" listed Other Sources
  (0xkuj, TIGI, Maxine's, ...; "$2.49" on a paid one, "Other device" on arm-only builds) and a tap opened the
  Add Source / Depiction alert.

## Tried that failed
- First Canister price on the site showed "Paid": lookup rows had no repository URI (fixed, see above).
- First headless run kept Not Jailbroken: setting `cydian.device` then a hash-only navigation doesn't reload the
  modules; needed `location.reload()`.

## Not verified
- Everything the app does with a vendor: sign-in, buy, authorize_download, install. The shell has none of
  net.request / device.info / keychain.* / auth.session / paid.install yet (F57, `native/**` is outside this
  task's files); until then the app's Purchase group shows the price as "Paid" and "needs a newer Cydian app".
  The client itself is tested against a fake vendor only, never a real account (would need a paid purchase).
- Whether Chariz/Havoc accept a callback to anything but sileo:// (no docs found; not testable without an account).
- Banner taps opening a package page from Home when the package's source hasn't loaded yet: the link goes to the
  source's package route; not clicked through in the headless run.
- iOS 6 look of the banners (Sileo has no iOS 6 counterpart, so no kit reference) and touch feel on a phone; dark
  mode not looked at.
- Add Source from a Canister result: the alert was opened, Add Source itself not tapped (would add a stranger's
  repo to the test profile; it calls the same `addSource` Home's More Sources uses).
- The 4S was not touched (the task didn't ask).
