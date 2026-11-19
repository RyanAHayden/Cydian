# B58: source icons in the jailbreak app

## What was wrong

1. **iFizBox's own repo** (`https://<DOMAIN>/repo/`): the Worker's `/repo/` only served Release, Packages(.gz) and
   `*.deb`, so `CydiaIcon.png` was a 404.
2. **http repos (BigBoss)**: the lookup order was already right (BigBoss keeps its icon at
   `http://apt.thebigboss.org/repofiles/cydia/dists/stable/CydiaIcon.png`, `<base>`, checked 2026-11-18 in the brief;
   `sourceIconUrls` asks `<base>` first, then the root). The app's Info.plist has no `NSAppTransportSecurity` key, so
   ATS is on: the WKWebView (page origin `ifizbox://app`) never loads `<img src="http://…">`, and URLSession's
   `net.fetch` can't fetch http either. Every http repo's icon was blocked, not just BigBoss'.
3. Icons were fetched again on every redraw and launch (a new `<img>` each time), so they blinked out and back.

## What changed

- `worker/src/index.js` `repoIcon`: `/repo/CydiaIcon.png`, `@2x`, `@3x` answer with the deployed
  `web/app/icons/icon-180.png` (the app icon: the same file as `native/icon/AppIcon60x60@3x.png`; no Apple art) from
  ASSETS, `Cache-Control: public, max-age=604800, stale-while-revalidate=86400`, CORS, nosniff. Never asks GitHub.
  404 without ASSETS. Test: `worker/test.mjs` "worker repo icon".
- `native/Sources/Icons.swift` (new), registered in `Bridge.swift`: bridge call `net.icon {url} -> {type, body}`.
  - http: one HTTP/1.1 GET over a Network.framework TCP connection (`NWConnection`), which ATS does not govern.
    `Connection: close`, `Accept-Encoding: identity`, Content-Length or chunked bodies, redirects (3 at most;
    a redirect to https goes through URLSession).
  - https: URLSession (ephemeral), its redirects handed back so an https -> http hop also works.
  - Safety: PNG/JPEG only by magic bytes (the server's Content-Type is ignored), 256 KB cap (cut off as it
    streams), 10 s per request. ATS stays on app-wide: no `NSAllowsArbitraryLoads`, no `...InWebContent`.
  - Errors: `not_found`/`upstream`/`bad_type`/`too_large` (the repo answered: no usable icon) vs
    `network`/`timeout` (no answer).
- `web/app/backend-native.js` `iconBytes(url)`: `net.icon`, base64 to bytes, the shell's error code kept.
- `web/app/core/iconcache.js` (new): the cache. One IndexedDB record per source key (database `ifizbox-icons`),
  shown before any network; refreshed in the background when more than a day old (or its URL is no longer in the
  list); a failed refresh keeps the old icon; "every place answered with no icon" remembered for a day; a network
  failure with nothing stored writes nothing (tries again next session); one refresh per source per session,
  shared between rows. PNG/JPEG checked again here.
- `web/app/source-icon.js` (new) `sourceIconImage(key, urls, backend)`: the row `<img>`. With `iconBytes` (the app)
  the bytes become a `blob:` URL in that `<img>` only; this session's blob URLs are kept in memory, so a redraw has
  the picture before any await. Without `iconBytes` (website) it walks the URLs through `assetUrl` as before. If
  the app's cache has nothing and the shell got no answer, it falls back to the old `<img>` walk over the https
  places only (an older shell without `net.icon`, or offline).
- Used by `screens/sources.js` (Sources tab rows) and `screens/manage.js` (Manage > Sources edit rows, Recommended
  rows). Home and package rows show package icons, not source icons, so there was nothing to change there.

## Decisions

- Page-side cache (IndexedDB) instead of a native file cache under Caches: one implementation, testable in node,
  and the WebView data already lives in `/var/mobile/Library/WebKit/com.ryha.ifizbox`.
- The website keeps its `<img>` + proxy path (its proxy and the browser's HTTP cache already keep icons, and the
  proxy is https so http repos work there).
- Network.framework rather than spawning the root helper per icon: no root process for a picture, and no curl
  dependency.

## Tests

- `node --test web/app/core/iconcache.test.js`: lookup order (BigBoss' `<base>` first, root fallback, junk skipped),
  cache hit shown with no network call, failed refresh keeps the icon (offline, 404, SVG, too big), no-icon memory,
  one refresh per session, store round-trip across a reopen.
- `node --test web/app/source-icon.test.js`: http icon as a blob: URL never an http `<img>`, cached icon with no
  network and instant redraw, fallback rules, website path unchanged, `iconBytes` codes.
- `worker/test.mjs`: "worker repo icon".
- `tools/check.sh`: passed (1303 node tests, worker, deb and IPA builds).

## On the iPhone 7 (ui-7.sh lock B58, 2026-11-18 20:14)

Installed build 0.9.7-1445 (this branch) over 0.9.7-1435.

- `b58-before.png` (0.9.7-1435): iFizBox and BigBoss show only their letters.
- `b58-after-1.png` (this build, first open): BigBoss shows its icon, fetched over http by `net.icon`. The
  https repos' icons (Chariz, ElleKit, GitHub avatars) still show.
- `b58-relaunch-0s.png`: the app killed (by its launchd pid) and opened again; the first screenshot, taken while
  "Downloading Packages" still runs, already has every icon, BigBoss included: they come from IndexedDB, with no
  refetch (each was fetched less than a day ago). A shot 1 s later and one after the refresh's redraws were the same.
- `b58-manage-sources.png`: Manage > Sources rows use the same cache.
- AltStore (apps.altstore.io) is a letter before and after: unchanged by this task.

## Not verified

- **iFizBox's own repo icon on the phone**: `https://ifizbox.com/repo/CydiaIcon.png` is still a 404, because the
  Worker change goes live only when this branch is merged and deployed (and this task must not deploy). The phone
  has now stored "no icon" for that source, so after the deploy it shows the icon at the next check, within a day
  (or at once after the app's WebKit data is cleared). Covered by the worker test only.
- **Flicker during a redraw**: checked with still screenshots (icons there at 0 s and 1 s after relaunch, and after
  the refresh's redraws). A still can't prove there's no single-frame blink. A screen recording would.
- **The NWConnection paths besides BigBoss'** (chunked bodies, an http -> https redirect, an over-256 KB or non-image
  answer on a live repo) ran only through the code. There's no Network.framework on the Linux build host, so no unit
  test exercises `PlainGet.parse`/`dechunk`. BigBoss's plain Content-Length answer was checked on the phone.
- **Sideload build**: it uses the same `net.icon` and cache, but was not installed or looked at (no task need, and
  the 7 runs the jailbreak build).
