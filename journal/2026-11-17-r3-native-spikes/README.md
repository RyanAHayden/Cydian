# R3: native shell open questions

Answers are in `docs/native.md`, "R3 answers". The spikes are in `native/spike/`. Raw trace output is here:
`trace-chromium.json` and `trace-webkit.json`.

## What I did
- **Spike app** (`native/spike/`): one Swift app with spike A (one WKWebView, JS stack, Web Animations push/pop, JS
  edge swipe), spike B (UITabBarController/UINavigationController, pooled WKWebViews re-targeted by `spike.show()`),
  and a probe page.
  - Two frame meters: the page's rAF, and the app's CADisplayLink.
  - A results screen that writes `spike-results.json`.
  - A switch for WebKit's private `PreferPageRenderingUpdatesNear60FPSEnabled`.
- **Built it on Linux into an IPA** (`build.sh`, 80 KB, arm64, minos 15.0, links only against `/usr/lib/swift`).
  Toolchain: swift.org 6.4.2 (ubuntu24.04 tarball, in the session scratchpad, not installed anywhere durable), the
  iOS 27.1 SDK opentennis already extracted, and rustup's ld64.lld.
- **Traced the web side** in system Chromium (Playwright, vsync and uncapped, CPU 1x/4x/6x) and in system
  WebKitGTK 2.54.1 (PyGObject, offscreen, XWayland). Both run `trace/scenario.js`.
- **Read Sileo's and Zebra's current source** (GitHub API) for how they get root.
- **Picked navigation (a).** Reasons and numbers are in docs/native.md.
- **Gate:** `native/spike/test_spike.py` (JS modules parse, list maths, Info.plist keys). It needed empty
  `native/__init__.py` and `native/spike/__init__.py` so that `unittest discover` walks into `native/`.
- **Plan:** notes on N1 (navigation choice, build recipe, arm64 only) and N2 (persona spawn, not setuid). Follow-up
  R6 (low): measure the spike on the 15 Pro.

## Scope change during the run
Another agent session relayed a message from the user: don't measure on an iPhone and don't block waiting for a
ProMotion phone. Pick from reasoning plus desktop WebKit/Chromium traces. It said the same note was on R3 in
plan/TODO.md (commit 7dc10d0). `agent-runner plan R3` in this worktree didn't show it yet. There was no ProMotion
phone here anyway, so I followed it. The IPA and R6 leave the phone measurement possible later.

## Tried and failed
- **Swift build:**
  - swiftc couldn't find `SwiftShims` with the default resource dir. Fix: `-resource-dir` holding a copied `shims` dir
    plus `-I` to it.
  - Without a custom resource dir, the Linux toolchain's CoreFoundation module clashed with the SDK's (CGPoint
    redefinition).
  - The ubuntu toolchain wants `libncurses.so.6`; Arch only has `libncursesw.so.6` (symlink shim on
    `LD_LIBRARY_PATH`).
  - Link failed on `_swift_FORCE_LOAD_$_swiftCompatibility56`. Fix: `-runtime-compatibility-version none`.
  - Link failed on `__isPlatformVersionAtLeast` (compiler-rt). Fix: `Sources/availability.c`.
  - arm64e: rustup lld rejects authenticated-pointer relocations. Not fixed, and not needed (see docs).
- **Tracing:**
  - Playwright's bundled WebKit needs Ubuntu libraries (ICU 74, flite, libxml2.so.2), and its bundled Chromium
    wasn't downloaded. I used `/usr/bin/chromium` and the system WebKitGTK instead.
  - WebKitGTK on Wayland: "GDK is not able to create a GL context" (core dump). `GDK_BACKEND=x11` works.
  - Relative dynamic `import('./meter.js')` from a WebKit user script doesn't resolve; an absolute URL does.
  - Headless Chromium paces rAF at 60 Hz, which hides per-frame cost. The uncapped run
    (`--disable-frame-rate-limit --disable-gpu-vsync`) shows it.

## Not verified
- **Nothing ran on an iPhone.** No ProMotion phone was available, and the user dropped that step (above). Unchecked
  on a phone:
  - the spike app launching at all;
  - frame rates of A and B;
  - whether `_WKFeature` `PreferPageRenderingUpdatesNear60FPSEnabled` exists and changes rAF on iOS 15–27;
  - the probe's results: module worker, IndexedDB on `cydian://`, bridge RTT, stream ordering.

  The IPA is built and unsigned; R6 covers this.
- **Desktop traces aren't phone timing.** WebKitGTK and Chromium on an x86 desktop don't use iOS's UI-side
  compositing or ProMotion. They show per-frame JS/layout cost and how frames are paced, nothing more.
- **Spike B's native transitions weren't traced** (UIKit doesn't run on Linux).
- **Spike A's swipe was driven by synthetic pointer events.** All 10 completed (`depthAfterSwipes` 2), but real touch
  coalescing on iOS wasn't exercised.
- **Root helper:** the persona-spawn route is read from Sileo/Zebra source, not run. That it works on Dopamine and
  palera1n is inferred from Sileo being their default package manager. The iOS 27 jailbreak doesn't exist yet.
- **Rootless .deb packaging, ldid/rcodesign signing, uicache:** described, not built (N1). Neither `dpkg-deb`, `ldid`
  nor `rcodesign` is installed here.
- **Theos:** not installed or tried. The plain swiftc route made it unnecessary for arm64.
