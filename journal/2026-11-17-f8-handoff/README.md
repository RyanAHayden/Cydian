# F8: handoff to a real package manager ("Open In")

## What I did

- `web/app/core/handoff.js` (pure, no DOM) builds every link: `sourceLinks(source)`, `packageLinks(id, source)`,
  `addLink(source, origin)` and `parseAddLink(search)`, `isAddPath`, `siteOrigin`. Tests: `core/handoff.test.js`
  (15 tests, every generated URL).
- `web/app/screens/handoff.js` draws the grouped **Open In** section: one "Open in <app>" row per app that takes
  the source's format, then **Add on Another Device**, which opens a sheet with a QR code of Cydian's `/add?url=` link
  (`core/qr.js`, the same encoder as Import & Export) and the link as text.
- Where it shows: an APT source's Sections page (under the sections) and an APT package page (under Source), in
  `screens/browse.js`. On an AltStore source page it replaces F9's three-row "Add to a Sideloader" group, and an
  AltStore app page gets it under Source (`screens/altstore.js`). `SIDELOADERS`/`installOptions().open` in
  core/altstore.js are left as they were: nothing on screen uses `.open` now, but tests and catalog.js use
  `installOptions`.
- Only the visitor's format: an AltStore source shows the sideloaders, an APT source the APT managers. A visitor set
  to Not Jailbroken (Settings > Device) sees no APT manager rows, only Add on Another Device, with a footer naming
  Settings > Device. A dist repo (suite + components) gets only Irisin, because Cydia's share page, Sileo and Zebra
  only add flat repos from a URL. Feather is left out for http (not https) sources, because it refuses them.
- `/add?url=…[&suite=…&component=…]`: `web/app.py` serves index.html at `/add` (a 4-line route outside
  `web/app/**`, which the task needed: Flask 404s a path with no file; test in `web/test_app.py`). `app.js` then
  rewrites the URL to `#/sources/manage/sources` and calls `manage.addSource(ctx, prefill)`, now exported with an
  optional prefill. A dist repo's suite and components appear in the alert's message and go along, as F48's object
  input, as long as the URL is left unchanged.
- The add link and QR use the page's own origin on the site; in the app (no http origin) they use
  `https://cydian.dev` (README's deploy host).

## Where each scheme was confirmed (source checked 2026-11-17)

APT (the brief's "unverified" list):
- **Cydia**: sbingner/cydia `MobileCydia.mm` (git.saurik.com returned 503; this is the GitHub mirror, last commit
  bea5ee0 2018), `pageForURL:forExternal:`: `cydia://url/<page>` opens `<page>` in Cydia's web view, where
  `window.cydia` exists. `cydia://package/<id>` is allowed from outside. `cydia://sources/add` only opens the empty
  prompt. The share page itself (fetched `https://cydia.saurik.com/api/share`, live) needs `window.cydia` and reads
  `#?source=<url>[&package=<id>]`. It builds the key `deb:<url>:./`, so flat repos only, then offers "Install the
  Source" and "Continue to Package" (`cydia://package/<id>`).
- **Sileo**: Sileo/Sileo `Sileo/AppDelegate.swift`, `url.host == "source"` → `SourcesViewController
  .presentAddSourceEntryField`, which does `absoluteString.replacingOccurrences(of: "sileo://source/", with: "")`,
  so the URL goes in raw (no encoding). Package: `Backend/URL Manager/URLManager.swift`, `sileo://package/<id>`
  (looks up an already-added source).
- **Zebra** (zbrateam/Zebra branch v1): `Zebra/ZBAppDelegate.m` `application:openURL:options:` case zbra, host
  `sources` → `ZBSourceListTableViewController handleURL:`, path split on `/add/`, so `zbra://sources/add/<url>` raw.
  Host `packages`: `zbra://packages/<id>?source=<url>` (query split on `source=`, so raw). If the source is missing it
  forwards to `zbra://sources/add/<url>` and then to the package.
- **Irisin** (was Saily, Lakr233/Irisin): `IrisinShared/Services/Common/IrisinLink.swift`:
  `irisin://repository/add?url=…[&suite=…][&component=…]` (URLComponents query items, so encoded; the address must
  start with http(s)://) and `irisin://package/<identity>`. Scheme registered in `Packaging/Irisin-Info.plist`.
- **Installer** (`installer://add/…`): **not shipped**. Installer 5 is closed source, so I couldn't confirm the
  scheme, and the brief says to confirm before shipping.

AltStore-format (list from StikDebug/altdirect `redirect.js`):
- AltStore: altstoreio/AltStore `AltStore/SceneDelegate.swift` case "source", `queryItems["url"]`. Info.plist
  registers `altstore`, `altstore-pal`, `altstore-com.rileytestut.AltStore`.
- AltStore Classic `altstore-classic://source?url=`: taken from AltDirect. The public AltStore repo's Info.plist
  doesn't list it (see Not verified).
- SideStore: SideStore/SideStore `SideStore/DeepLinks/URLHandler.swift` case "source", `queryItems["url"]`.
- Feather: khcrysalis/Feather `Feather/FeatherApp.swift` `validatedScheme(after: "/source/")`
  (NimbleKit `URL+validateScheme.swift` requires the rest to start with `https://`), so the URL goes in raw.
- LiveContainer: LiveContainer/LiveContainer `LiveContainerSwiftUI/Views/LCAltStoreSourcesView.swift` handleURL,
  host "source", query item "url".
- TrollApps: TheResonanceTeam/TrollApps `Views/SourcesView.swift` onOpenURL `hasPrefix("trollapps://add?url=")`,
  then URLComponents query items (`Extensions/Extensions.swift`), so encoded works.
- StikStore `stikstore://add-source?url=<encoded>`: as AltDirect sends it. I found no public StikStore source.

## Checked

- `node --test web/app/core/handoff.test.js`: 15/15. `web/test_app.py` with the new `/add` test passes.
- Headless Chromium (CDP script in the session scratchpad, local Flask): Chariz's Sections page shows Open In
  (Not Jailbroken: only Add on Another Device; Jailbroken (Rootless): four managers + add). A Chariz package page
  shows four rows with the right footer. FIZL0's AltStore source page shows seven sideloaders + add, and an app page
  shows the same eight rows. `/add?url=https://apt.procurs.us/&suite=1800&component=main` lands on Sources > Manage >
  Sources with the alert filled in ("Suite 1800, main."). The QR sheet's code decodes (zbarimg) to the add link.

## Not verified

- No link was opened in the real apps: there is no jailbroken modern iPhone or sideloader here, and the 4S (iOS 6)
  runs none of these apps except Cydia, and the task doesn't say to drive it. The schemes come from each app's source
  code (above), not from a tap.
- `altstore-classic://`: not in AltStore's public Info.plist. It is kept because AltDirect sends it and the brief
  lists it. If AltStore Classic doesn't register it, the row does nothing there.
- StikStore: no public source found, so the link is AltDirect's form only.
- Cydia's share page reads `#?source=` with menes' `$.query`, whose decoding I couldn't read (minified JS from
  saurik's server). The URL goes in raw, as saurik's own share links do, with only `% & # + space` escaped. A source
  URL holding one of those would rely on `$.query` decoding it.
- Scanning the QR with a phone's Camera, and `/add` opening on an iPhone: only checked in desktop Chromium.
- Not checked in the native app (WKWebView): there the add link points at https://cydian.dev, and N4 replaces these
  rows with the real queue anyway.
