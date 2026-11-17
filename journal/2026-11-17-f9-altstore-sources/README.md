# F9: AltStore sources (IPA apps) beside APT repos

## What was done

- `web/app/core/altstore.js` (new, pure JS): parses AltStore source JSON, both the 2.0 format (`versions`) and 1.x
  (version, versionDate, versionDescription, downloadURL, size on the app; `screenshotURLs`; `permissions`).
  It reads apps, versions (`downloadURL`, `size`, `date`, what's-new text, `minOSVersion`/`maxOSVersion`),
  screenshots (strings, `{imageURL,width,height}`, or `{iphone,ipad}`), `appPermissions` (entitlements, and privacy
  as an object or a list), `news` (sorted newest first, with `notify`), `tintColor` (hex only, since it goes into CSS),
  `headerURL`, `iconURL`, `featuredApps` (ids with no app are dropped) and `website`. Broken optional fields are
  dropped rather than thrown. Apps with no id or no version, and duplicate ids, are skipped.
- Which version shows: `appStanza(app, source, ios)` keeps only the versions the phone's iOS runs. The newest of
  those is the candidate. An app with no runnable version is left out of the catalog entirely, so Changes never
  files it and no notification can come from it. `maxOSVersion "16"` means any 16.x, the same rule as core/compat.js.
- Catalog (`core/catalog.js`): new ops `loadAlt(key, json, ios)` and `altSource(key)`. Apps become rows
  (`kind: "ipa"`) in the section `Apps (<Category>)`, so Search's Apps scope finds them. They show in All Sources,
  Search and Changes with no Changes-specific code: `versions()` already feeds Changes. `slim` passes `kind` through.
- `core/compat.js`: `isApp` also accepts `kind: "ipa"`, because catalog stanzas carry a Package (the bundle id).
  Without this, a non-jailbroken phone would have called every app "Jailbreak only".
- Source list: `withAltSources(calls, backend)` wraps both backends' source calls. AltStore sources are kept in
  their own IndexedDB database (`cydian-altsources`), so apt's sources.list (F33) and the helper never see them.
  The Add Source alert takes a `.json` URL, or an `altstore://` / `sidestore://` / `feather://source?url=` link,
  and tries it as AltStore first. If the APT check reports `not_repository`, it falls back to AltStore. If that fails
  too, APT's message stands. Refresh and Delete work by key.
- `catalog.js` (UI): loads an AltStore source's JSON (cached in the index cache like a Packages text). The phone's
  iOS is in that source's signature, so changing the iOS version reloads it.
- `screens/altstore.js` + `altstore.css`:
  - **Source page** (Sources > an AltStore source): header in the source's tint with its banner and icon, the
    description, News cards (one about an app opens the app; one with a url opens the url), Featured apps, All Apps,
    "Add to AltStore/SideStore/Feather", and Website.
  - **App page**: icon, developer, version (build), size and the compat badge, then Permissions *before* Install.
    Install shows `itms-services` only when the source gives a signed link: a `downloadURL` that already is
    itms-services, or a `manifestURL` / `installURL` .plist. Otherwise it offers Open in AltStore/SideStore/Feather
    (`<scheme>://source?url=`) plus Download IPA. Below that: What's New with its date, Screenshots,
    the description, Details (Version, Size, Updated, Developer, Category, Compatibility, Bundle ID), Version History
    (runnable versions only, each with date, size and notes), and Source.
- `push-client.js`: the server-side subscription gets the APT sources only. AltStore sources have no dpkg upgrades,
  and the server would otherwise try to fetch them as APT repos.
- Tests: `core/altstore.test.js` with `core/fixtures/altstore-source.json`. They cover: the fixture parsing into
  rows per iOS version; compat on a non-jailbroken phone; Changes listing a bumped version but never one the phone
  can't run; source fields, news, permissions and screenshots; bad input; OS ranges; install options; news to
  notify; URL handling; and add/list/refresh/remove with a fake IndexedDB.

## Checked in Chromium

`tools/serve.py` serves web/app with a fake `/api/fetch` that returns the fixture at https://example.dev/apps.json.
`tools/shots.mjs` drives headless Chromium over CDP at 390x844 3x with an iOS 16.5 user agent. Shots are in
`shots/`:
- the source row with its count of 3;
- the source page in the fixture's purple tint;
- Emu's page, showing 1.5 (2.0 needs iOS 17 and is hidden, in history too) with permissions above Install;
- Signed's page, with the itms-services Install row;
- Changes, listing Legacy 3.2 after a refresh with the bump.

No console errors. The red subtitles on the APT rows are expected: the fake proxy answers 404 for every other URL.

## Failed along the way

- `versions.map(parseVersion)` passed the array index as the `legacy` flag, so version 1+ lost its notes. Fixed
  with a wrapper; the fixture test caught it.
- Bare dates ("2026-10-01") parsed as UTC midnight showed as the day before west of UTC. They now parse as local
  midnight.

## Decisions (unattended)

- "A signed link exists" is read as: the source gives an itms-services URL or a manifest .plist. Standard AltStore
  JSON has neither (its IPAs are unsigned), so most apps get the sideloader links. `manifestURL`/`installURL` are not
  AltStore fields; they are accepted in case a source adds them.
- The Feather link uses `feather://source?url=` as the brief says. F37 later makes the sideloader a setting.
- AltStore sources are device-only in the native app too (never written to apt's sources).

## Not verified

- **The sideloader URL schemes on a real phone.** `altstore://source?url=` is AltStore's documented scheme.
  `sidestore://source?url=` and `feather://source?url=` follow the brief; I could not open them without an iPhone
  that has those apps. Feather may expect a different path.
- **itms-services install from the site or the PWA.** No signed manifest or device was available; the link format
  is the standard `itms-services://?action=download-manifest&url=`.
- **Real-world sources** (e.g. AltStore's own, SideStore's community sources). There was no network fetch from this
  sandbox; only the fixture was tested, written from the format docs as I remember them.
- **Screenshots and banner images.** In the Chromium run they failed to load (offline fake proxy) and were removed
  as designed. Their layout (the horizontal strip, the banner under the name) was not seen with real images.
- **The native app** (backend-native wrap): node tests pass, but the app was not run on a phone. Per AGENTS.md the
  4S is not to be touched unless the task says so, and it runs iOS 6 anyway.
- **News push for `notify: true`:** core `newsToNotify` exists and is tested. Wiring it into web/push.mjs and
  device-check.js is outside this task's files and is filed as F39.
- **Dark theme** look of the source and app pages was not screenshotted.
