# Native app: decision

Decided by the user on 2026-11-17. R3 fills in the open questions at the bottom; the shape itself is settled.

## Shape

**A native shell around a WKWebView, running the same frontend as the public site.** It's the same split Cydia
used: native code for root and apt, web for the UI. This time the web part is the whole UI, so it's written once.

```
web/app/            one frontend: HTML, CSS, vanilla JS (ES modules, no build step)
  core/             parsing, version compare, sections, Changes, upgrades: pure JS, tested with `node --test`
  backend-http.js   on the site: talks to Flask (fetch proxy and cache, push)
  backend-native.js in the app: talks to Swift over window.webkit.messageHandlers
web/app.py          Flask: serves web/app/, an SSRF-safe fetch proxy with a cache, Web Push. Thin.
native/             Swift shell, root helper, daemon
```

The UI never knows which backend it has. Both expose the same calls (`sources()`, `refresh()`, `packages()`,
`installed()`, `queue()`, ...). On the site, raw `Packages` files come through the server's proxy. In the app they
come from apt's own lists on disk (after `apt-get update` through the helper), and installing goes through the
helper. Parsing, Changes, upgrades and search all run in `core/` in both places.

## Feel: 120 Hz or it's wrong

- `CADisableMinimumFrameDurationOnPhone = YES` in the app's Info.plist. Without it, WKWebView animations are capped
  at 60 Hz on ProMotion phones.
- Animate `transform` and `opacity` only (compositor). Nothing that triggers layout during scrolling or
  transitions.
- Long lists (BigBoss is tens of thousands of packages) get a virtualised list. `content-visibility: auto` alone
  isn't enough at that size.
- Heavy parsing (`Packages` files are megabytes) runs in a Web Worker, so the UI thread never blocks. The parsed
  index is cached in IndexedDB.
- Navigation has to feel native: push/pop with the iOS curve and parallax, and an interactive edge-swipe back that
  follows the finger. R3 decides how (see below).
- Taps react instantly (`touch-action: manipulation`, active states on `pointerdown`), with no text-selection or
  callout surprises, and the scroll bounce matches iOS.

## Targets

- The upcoming iOS 27 jailbreak first, and older jailbreakable versions too, since more phones run them:
  rootless (`/var/jb`, Dopamine, palera1n) from iOS 15 up. Deployment target iOS 15. arm64 only (R3: an app, its
  helper and its daemon run as arm64 on arm64e phones; arm64e is only needed for code injected into system processes).
- The iPhone 4S (iOS 6) is a reference device only. It never runs Cydian.


## R3 answers (2026-11-17)

The spikes, their build and the traces are in `native/spike/` (README there). Journal:
`journal/2026-11-17-r3-native-spikes/`.

### 1. Navigation: (a) one WKWebView, JS stack and JS swipe-back

**Picked: (a).** No ProMotion phone was available to this run. A note relayed from the user during the run (by
another agent session) dropped the on-phone measurement: pick from reasoning plus desktop WebKit/Chromium traces.
So the choice rests on how WebKit draws on iOS plus desktop traces of both spikes. `native/spike/build.sh` makes an unsigned IPA of the
spikes with an on-device meter, so the phone numbers can be added whenever a ProMotion phone is free (see
"Measuring on a phone" below).

Why (a):

- **Push and pop cost the page nothing per frame.** They are Web Animations on `transform`/`opacity`. iOS WebKit
  composites in the UI process and hands such animations to Core Animation, so they run at the display's rate even
  while JS is busy. In the traces, rAF kept free-running during push/pop (about 240 Hz in WebKitGTK's unpaced
  offscreen window), so the animation never waited on the main thread.
- **The swipe and the list are cheap per frame.** The JS swipe writes one `transform` per frame (pointer events
  coalesced into one rAF write). The virtual list moves about 30 recycled rows. Chromium with no vsync and the CPU
  slowed 6x: swipe p95 2.6 ms and fast scroll p95 2.9 ms per frame, against a 8.33 ms budget at 120 Hz.
- **One frontend, as decided.** (b) would need two navigation systems: native on the phone, CSS on the site, plus
  `html.native` switches. It would also put every screen in its own JS heap (its own WebContent memory, its own copy of
  the parsed 30k-package index, or a trip over the bridge for it). Queue state and badges would have to be synced
  between views. (a) is the site's own code.
- **(b)'s pooled views aren't free either.** Re-targeting a recycled view (`show()` to the second painted frame) took
  2 frames at 60 Hz in Chromium and 17–40 ms in WebKitGTK. That's before Swift's `evaluateJavaScript` hop, which
  the trace doesn't include. A push either waits for it (tap latency) or slides in a view that's still blank or stale.

What (a) must do to hold 120 Hz (N1 builds it like this):

- `CADisableMinimumFrameDurationOnPhone = YES` (Info.plist).
- **Switch off WebKit's "prefer page rendering updates near 60 fps".** It's on by default on iOS and keeps
  `requestAnimationFrame`, and so every JS-driven frame (the swipe), near 60 Hz. Compositor animations and native
  scrolling aren't affected. The switch is private, and fine for a jailbreak app: WKPreferences
  `+_features` → the `_WKFeature` with key `PreferPageRenderingUpdatesNear60FPSEnabled` →
  `-_setEnabled:NO forFeature:` (`WebKitFeature` in `native/spike/Sources/Bridge.swift`). The spike's menu lists
  the frame-rate features a phone's WebKit has, with their defaults.
- Push/pop: Web Animations (`element.animate`) on transform/opacity only. Commit the end state and cancel the
  animation when it finishes. Hide the covered screen (`visibility: hidden`) once the push ends.
- Edge swipe: a 24 pt strip with `touch-action: none` takes the pointer. Content areas get `touch-action: pan-y` so
  vertical scrolling stays native. Write `transform` once per rAF from the latest coalesced pointer position. On
  release, finish or cancel by distance (> half) or velocity (> 0.4 pt/ms) with a short ease-out animation.
- Each screen scrolls in its own `overflow-y: auto` box (a native UIScrollView in the UI process), with a virtualised
  list: a fixed pool of absolutely positioned rows moved by `translate3d`. `web/app/` can take `list.js` from the spike.
- Parsing in a Web Worker (module workers load from the app scheme; see 4), the index cached in IndexedDB.
- **Fallback if a phone shows the JS swipe lagging the finger:** make the back gesture a native scroll. The top two
  screens sit in a horizontal `overflow-x: scroll` + `scroll-snap` box, and the pop fires on `scrollend` at the left
  snap point. It follows the finger at 120 Hz with no JS per frame. Parallax then needs scroll-driven animations
  (Safari 26+) and is left out below that. This wasn't built.

Desktop traces (`native/spike/trace/`: `trace.mjs` for Chromium, `trace_webkit.py` for WebKitGTK; both run
`trace/scenario.js`: 10 pushes, 9 pops, 10 edge swipes with synthetic pointer events, 3 s of fast scroll on the
30k list). Numbers are rAF frame intervals in ms, p50 / p95 / max:

| run | A push | A pop | A swipe | A fast scroll | B fast scroll | B re-target |
|---|---|---|---|---|---|---|
| Chromium uncapped, CPU 1x | 0.2 / 0.3 / 3.6 | 0.2 / 0.4 / 2.5 | 0.2 / 0.3 / 2.4 | 0.3 / 0.5 / 1.2 | 0.5 / 0.6 / 4.2 | 19.5 / 20 / 20 |
| Chromium uncapped, CPU 4x | 0.6 / 0.9 / 10.8 | 0.5 / 0.9 / 6.8 | 0.6 / 1.6 / 6.5 | 1.4 / 1.9 / 4.1 | 1.7 / 2.2 / 6.6 | 24.9 / 26.6 / 26.6 |
| Chromium uncapped, CPU 6x | 0.9 / 1.5 / 14.6 | 0.9 / 1.5 / 11.4 | 1.0 / 2.6 / 9.3 | 2.1 / 2.9 / 7.8 | 2.6 / 3.3 / 9.3 | 28.6 / 30.2 / 30.2 |
| Chromium 60 Hz vsync, CPU 1x/4x/6x | 16.7 / ≤16.8 / 16.8 | same | same | same | same | 33.3 / ≤34.9 |
| WebKitGTK 2.54.1, offscreen | 4 / 5 / 22 | 4 / 17 / 21 | 16 / 17 / 18 | 17 / 18 / 18 | 17 / 17 / 17 | 17 / 40 / 40 |

- "Uncapped" is Chromium with `--disable-frame-rate-limit --disable-gpu-vsync`, so an interval is what the frame
  cost. The vsync rows missed no frame at any slowdown.
- The single slow frames (A push max 10.8–14.6 ms at 4–6x) are the first frame of a push, when the new screen and its
  list are built. If a phone shows a hitch there, build the screen one frame before starting the animation.
- WebKitGTK paces frames that change layers from JS (swipe, list re-render) at its offscreen compositor's ~60 Hz,
  and frees rAF up to ~240 Hz when only compositor animations run. That shows the split, not phone timing.
- Spike B's push, pop and swipe are UIKit's own and can't be traced on a desktop. On a phone they run at 120 Hz in
  the render server: that part of (b) was never in doubt.

**Measuring on a phone.** `native/spike/build.sh` → `native/spike/build/CydianSpike.ipa` (unsigned, about 80 KB,
arm64, iOS 15+). It needs no jailbreak, so sign it through sidedrop like the opentennis IPA and install it on the
iPhone 15 Pro. Its menu has Spike A, Spike B, a probe page and Results. There are two switches: the WebKit 60 fps
preference, and the native CADisplayLink meter (which itself holds the display at 120 Hz).

Protocol, for each spike and with the 60 fps switch both on and off:
1. Tap Auto: 10 pushes, 10 pops, 3 s of fast scroll.
2. Do 10 edge swipes back.
3. Do 10 hard flings on the 30k list.

Results shows, per spike/source/phase:
- fps, p50/p95/p99/max frame interval;
- frames over 1.5× budget;
- hitch ms per second.

"native" = the app's display link; "js" = the page's rAF. Results also writes `spike-results.json` to the app's
folder in the Files app. Paste the table here when it exists.

### 2. Building on Linux

**Built and checked here (not on a phone yet): Swift 6.4.2 from swift.org + the iOS 27.1 SDK + rustup's
`ld64.lld`.** Theos isn't needed. `native/spike/build.sh` is the recipe; N1 copies it.

- **Toolchain:** the swift.org `ubuntu24.04` tarball, unpacked anywhere. Its compiler (6.4.2) has to read the SDK's
  `.swiftinterface` files (made by Apple Swift 6.4). A different minor version refuses with "this SDK is not
  supported by the compiler". On Arch it wants `libncurses.so.6`; a symlink to `libncursesw.so.6` on
  `LD_LIBRARY_PATH` does it.
- **SDK:** `iPhoneOS.sdk` extracted from an Xcode `.xip` on Linux by opentennis' `tools/ios-sdk.py`, already at
  `~/.local/share/hst-ios/iPhoneOS.sdk` (Xcode 27.1, iOS 27.1). It also renames `arm64e.x1` to `arm64` in the
  `.tbd` stubs, which lld needs.
- **Compile:** `swiftc -parse-as-library -wmo -swift-version 5 -target arm64-apple-ios15.0 -sdk $SDK
  -resource-dir R -I R/shims -runtime-compatibility-version none -c`.
  - `R` holds a copy of the toolchain's `usr/lib/swift/shims` and a link to its `clang` headers. The toolchain's own
    resource dir is the Linux one: its CoreFoundation/dispatch module maps clash with the SDK's.
  - `-runtime-compatibility-version none` drops `libswiftCompatibility56.a`, Xcode's back-deploy shim for iOS
    15.0–15.3. It's needed only for concurrency on those releases; Cydian avoids `async` until it targets 15.4+.
  - The SDK only has arm64e interfaces; the arm64 build reads them without complaint.
- **Link:** `clang -target arm64-apple-ios15.0 -isysroot $SDK -fuse-ld=lld --ld-path=<rustup>/gcc-ld/ld64.lld
  -L $SDK/usr/lib/swift -Wl,-rpath,/usr/lib/swift`. Plus `availability.c` (in the spike): `#available` calls
  `__isPlatformVersionAtLeast`, which Xcode takes from compiler-rt and Linux clang doesn't have for iOS. The result
  links only against the OS's Swift runtime in `/usr/lib/swift` (present since iOS 12.2), with minos 15.0.
- **arm64e does not link** (rustup's lld 23.1 rejects arm64e's authenticated-pointer relocations). It isn't needed:
  apps, setuid/spawned helpers and launch daemons run as arm64 on arm64e phones, and Procursus' rootless packages
  are arm64. Only tweaks injected into arm64e system processes need arm64e. If Cydian ever needs it, Theos' Linux
  toolchain (`bin/install-theos`, which ships Apple's ld64 via cctools-port) can link it.
- **Rootless .deb (N1, not built here):**
  - Package architecture `iphoneos-arm64`. The app goes in `/var/jb/Applications/Cydian.app`; the helper and daemon
    under `/var/jb/usr/libexec/cydian/` and `/var/jb/Library/LaunchDaemons/`. The postinst runs
    `uicache -p /var/jb/Applications/Cydian.app`.
  - `dpkg-deb` isn't on this Arch machine. A .deb is an `ar` of `debian-binary`, `control.tar.xz` and
    `data.tar.xz`, which Python's stdlib (`tarfile`, plus a 60-byte ar header writer) can produce without new
    dependencies.
  - Signing: ad hoc with entitlements (the jailbreak trusts ad hoc code). Use `ldid -S<ents>` (Procursus' ldid builds
    on Linux) or `rcodesign sign --entitlements-xml-file` (Rust, `cargo install apple-codesign`). Neither is
    installed yet.
- **The `/var/jb` prefix:**
  - On Dopamine and palera1n rootless, `/var/jb` is a symlink to the real (randomised) prefix, so plain
    `/var/jb/...` paths work.
  - roothide (a Dopamine variant) has no `/var/jb`; there, `jbroot()` from libroothide maps paths.
  - Cydian resolves the prefix once at start: `jbroot("/")` if libroothide loads (dlopen/dlsym), else `/var/jb` if
    it exists, else `/` (rootful). Every apt/dpkg path goes through that one function. libroot does the same for C
    code but isn't needed from Swift.

### 3. Root: no setuid helper on iOS 15+

**What Sileo and Zebra do** (read from their current source, 2026-11-17):

- On iOS 13 and later, neither uses its setuid binary. Both spawn apt directly as root with the persona spawn
  attributes: `posix_spawnattr_set_persona_np(&attr, 99, POSIX_SPAWN_PERSONA_FLAGS_OVERRIDE)` plus
  `posix_spawnattr_set_persona_uid_np/gid_np(&attr, 0)`.
- That's allowed because the app is signed with the private entitlement `com.apple.private.persona-mgmt` (beside
  `platform-application`, `com.apple.private.security.no-sandbox` and `com.apple.private.security.no-container`).
- Their setuid helpers are for iOS 12 and earlier only. Zebra's `utils/supersling.c` prints "supersling isn't used
  on iOS 13+". Sileo's `giveMeRoot` is reached only in the `else` of `#available(iOS 13, *)` in `RootWrapper.swift`.
- Those old helpers checked their caller by comparing `proc_pidpath(getppid())` to the app's executable (Sileo:
  `realpath` compare; Zebra: same device and inode). They then called `jb_oneshot_fix_setuid_now` from
  `libjailbreak.dylib` before `setuid(0)`, because the jailbreaks of that era didn't honour the setuid bit by
  themselves.
- Sileo also has an XPC root daemon (`SileoRootDaemon`), but only for Mac Catalyst.

**Cydian (iOS 15+):**

- The app gets those four entitlements. It runs one small helper, `/var/jb/usr/libexec/cydian/cydian-helper`, as
  root through the persona attributes. The helper has no setuid bit.
- The helper keeps N2's allowlist: only `apt-get update|install|remove|upgrade` and `dpkg --configure -a`, package
  names matching `[a-z0-9.+-]+`, no options from the caller. Then it `execv`s apt from the resolved prefix. So all
  root work goes through one checked place even though the app could spawn anything.
- **Caller check:** without a setuid bit the helper can't become root unless an entitled process spawns it. Any other
  process running it gets plain `mobile`, and apt fails on the lock files. So the check that matters is the
  entitlement, which the kernel enforces. As defence in depth, the helper still refuses unless `getuid() == 0` and
  its parent's executable (`proc_pidpath(getppid())`) is the same file (device + inode) as
  `<prefix>/Applications/Cydian.app/Cydian`.
- **Does it work on Dopamine and palera1n?** Sileo is the default package manager on both, and it works this way
  there. That's the evidence; Cydian itself hasn't been run on either (N6).
- **For the iOS 27 jailbreak:** it isn't out, so this can't be checked. If it doesn't honour private entitlements
  for ad hoc apps, the fallback is a root LaunchDaemon (`/var/jb/Library/LaunchDaemons`, `UserName root`) holding
  the same allowlist behind a Unix socket. It would check the peer's uid and executable with `LOCAL_PEERPID` +
  `proc_pidpath`. N5's daemon could take that role.
- **Output:** spawn with stdout/stderr pipes and pass apt `-o APT::Status-Fd=3` with fd 3 as a third pipe. Status
  lines (`pmstatus:pkg:percent:text`) give the progress bar; stdout/stderr give the console. Sileo and Zebra both
  read status-fd this way.

N2's text still says "a setuid binary (per R3)"; R3 put a note on N2.

### 4. Bridge and the offline bundle

**Requests:**

- JS calls `window.webkit.messageHandlers.cydian.postMessage({id, method, params})`, which returns a promise.
- Swift registers a `WKScriptMessageHandlerWithReply` (iOS 14+) with
  `addScriptMessageHandler(_:contentWorld: .page, name: "cydian")`. It answers through `replyHandler(result, nil)`,
  or `replyHandler(nil, "message")`, which rejects the promise with `Error(message)`.
- Values are plain JSON types (dictionaries, arrays, strings, numbers, booleans, null). `id` is the caller's counter
  and is only needed for streams. Method names are dotted: `sources.list`, `apt.update`, `apt.install`,
  `dpkg.status`, `queue.confirm`, and so on.

**Streams (apt's console, progress):**

- JS sends the request with `stream: true` and registers `id` in a map.
- Swift pushes batches of events with `callAsyncJavaScript("cydianNative.emit(id, events)", arguments:)`. Arguments
  are serialised by WebKit, so there's no string-built JS.
- Event shapes: `{type: "output", fd: 1|2, text}`, `{type: "status", pkg, percent, text}` (from status-fd), and
  `{type: "exit", code}` last. The reply then settles the promise and JS drops the map entry.
- Batching: output is buffered in Swift and flushed at most once per 16 ms, so a chatty `apt-get` costs the page one
  call per frame, not one per line.
- The final `exit` event is part of the stream so that JS has it even if the reply overtakes the last `emit`. Both
  travel over WebKit IPC and should stay in order, but the probe counts lines to check.
- The client is `native/spike/web/bridge.js`; the Swift side is `Bridge` in `native/spike/Sources/Bridge.swift`.
  `backend-native.js` (N3) builds on them.

**Offline bundle:**

- `web/app/` is copied into `Cydian.app/web/` at build time.
- It's served through a `WKURLSchemeHandler` as `cydian://app/...`, with the right MIME types, `no-cache`, and
  paths kept inside the bundle (`AppScheme` in `Bridge.swift`). Nothing loads from the network. Repos are fetched by
  Swift (or by apt) and handed over through the bridge.
- `loadFileURL` is not used. `file://` pages get an opaque origin, which WebKit treats badly for ES modules, module
  workers and IndexedDB. A custom scheme is a real origin, so `web/app/` behaves exactly as on the site.
- The probe page (`probe.html`) checks on a phone, against `cydian://app`:
  - module scripts, a module worker and IndexedDB;
  - a bundled `fetch`;
  - bridge round-trip time (200 pings);
  - a 2000-line stream;
  - error rejection.
- **Not verified** until it runs on a phone (the desktop runs used `http://`).
