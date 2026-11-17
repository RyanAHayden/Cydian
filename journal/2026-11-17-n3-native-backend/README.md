# N3: the app's backend and the Swift side of the bridge

## What was done

- `web/app/backend-native.js`: the same calls as `backend-http.js` (`fetch`, `text`, `assetUrl`, `packages`, the
  source-list calls) plus `helper(words, onEvent)`, `dpkgStatus()` and `update()`, answered by the shell through
  `cydianNative.call(method, params, onEvent)`.
  - Sources are apt's: `sources.list`, `sources.list.d/*.list` and deb822 `*.sources` (new `core/aptsources.js`,
    pure, tested). Counts, origin and refresh times live in IndexedDB (`cydian-native-sources`), merged in by key.
  - `packages(dir)` reads apt's list file first (apt's `URItoFileName`; flat repos are `<host>_._Packages`), and
    falls back to the network (`net.packages`: the shell tries Packages.xz, .gz, plain) when apt has none.
    `text()` of a Release/InRelease does the same; when apt holds the other of the two, the asked-for one is
    `not_found` without touching the network, so `releaseOf` moves on.
  - `refreshSources` runs `apt-get update` through the helper first and throws BackendError `helper` with apt's
    last stderr line when it fails (Zebra #2052: never silently), then refreshes every source from the lists.
  - Add Source: checked like on the site and kept on the device (`added: true`) beside apt's sources. Writing it into
    apt's sources needs a root helper verb: filed as **F33**. Removing a source from apt's own files is refused
    with a message naming the file (the Sources tab shows it in its Error alert).
- `web/app/backend.js`: `getBackend()` picks the native backend when `cydianNative.call` exists.
- `native/bridge.js`: injected by the shell at document start (WKUserScript), so `cydianNative` exists before any
  module loads (`screens/settings.js` reads `cydianNative.helper` and `catalog.js` `cydianNative.dpkgStatus` at load).
  Sets `cydianApp` for `nav/haptic.js`. Leaves `mode` unset (core/settings.js reads that as jailbreak; I2 sets it).
- `native/Sources/Apt.swift`: `apt.sources`, `apt.list`, `apt.dpkgStatus`, `net.fetch` (base64 body, 64 MB cap,
  30 s timeout), `net.packages` (xz via `NSData.decompressed(.lzma)`, gzip header stripped then `.zlib`), `helper.run`
  (`cydian_helper_spawn` from N2's `spawn.c` via a bridging header; fds 1-3 read on three threads, lines streamed
  with `emit`), `haptic.tap` (light `UIImpactFeedbackGenerator`). The jailbreak prefix: `jbroot("/")` if loaded, else
  `/var/jb` if present, else rootful.
- Build: `build.sh` compiles `spawn.c` into the app, builds `cydian-helper` into
  `/var/jb/usr/libexec/cydian/` (0755, ad hoc signed; `ldid -S` when ldid is the signer), ships `bridge.js`.
  `mkdeb.py check` now fails a .deb without the helper, with a helper not 0755 (setuid) or not an arm64 iOS
  executable, or without `bridge.js`. `entitlements.plist` gains `com.apple.private.persona-mgmt`.
- Tests without a device (user 2026-11-17): `native/fake/` is the Swift side in node (`fake-native.mjs`) over a
  fixture prefix, with `native/fake/cydian-helper`, a shell stand-in with the real allowlist and exit codes whose
  `update` copies `fixture/remote/lists/` into apt's lists dir. `web/app/backend-native.test.js` runs the backend
  against it, offline, and feeds apt's lists, dpkg's status and `showhold` into core/catalog.js and core/settings.js:
  Available Upgrades (apt, the tweak) and Ignored (the held one) come out as on the site. It also runs
  `native/bridge.js` in a vm with a fake message handler.

## Tried and dropped

- Decompressing network fallbacks in JS: `DecompressionStream` has gzip but no xz or bz2. The shell does it instead.
- First refresh test failed: a flat repo whose apt list is InRelease asked the network for Release (offline in the
  test) and lost its origin. Fixed with the "other one is local" rule above.

## Not verified

- **Nothing ran on a phone** (no jailbroken modern test phone, user 2026-11-17). The Swift code compiles and links
  (`make -C native package` passed here with Swift 6.4.2 + the iOS 27.1 SDK), but none of it has run: the persona
  spawn, reading `/var/jb` files from the app, the WKUserScript timing, `callAsyncJavaScript` emits, haptics.
- apt's list file names are from apt's `URItoFileName` as I know it (flat repos `host_._Packages`); not compared with
  a real `/var/jb/var/lib/apt/lists`. If apt is set to keep compressed lists (`Acquire::GzipIndexes`, `.lz4`), the
  backend won't find them and falls back to the network.
- Whether `<img>` on the `cydian://app` origin loads `http://` icons (mixed content) in WKWebView: `assetUrl`
  returns the repo URL as is. If it doesn't, serve icons through the app scheme.
- bz2-only repos have no network fallback in the app (only before `apt-get update` knows them; after it apt's lists
  are used).
- The arch is still `cydian.arch` / iphoneos-arm64 by default, not asked from dpkg.
