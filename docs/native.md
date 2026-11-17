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
  rootless (`/var/jb`, Dopamine, palera1n) from iOS 15 up. arm64 and arm64e. Deployment target iOS 15.
- The iPhone 4S (iOS 6) is a reference device only. It never runs Cydian.

## Open questions for R3

1. **Navigation:** either (a) one WKWebView with a JS-driven navigation stack and a JS edge-swipe, or (b) a native
   UINavigationController and UITabBarController, with a small pool of recycled WKWebViews (one per visible
   screen) and native swipe-back. Build both as a spike and measure on a ProMotion phone: frame times during push,
   pop, interactive swipe and fast scroll of a 30k-row list. Pick the one that holds 120 Hz. Drawing the iOS 6 nav
   bar and tab bar natively (from the kit's HD assets) is allowed if (b) wins. The site then draws them in CSS, and
   `html.native` hides the CSS versions.
2. **Building on Linux:** Theos with the Swift toolchain plus an iOS SDK, or another route. Rootless packaging
   (`iphoneos-arm64`) and the `/var/jb` prefix (libroot / `jbroot()`).
3. **Root:** how Sileo and Zebra run apt as root on rootless jailbreaks (a setuid helper like `giveMeRoot` or
   `supersling`, and whether that still works on Dopamine and palera1n). How the helper checks that its caller
   is Cydian.
4. **Bridge:** message format between JS and Swift (request id, streaming console output for installs), and how
   the app bundles `web/app/` offline (loaded from the app bundle, never from the server).
