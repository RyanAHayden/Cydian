# R3 navigation spike

Throwaway code that answered R3 (`docs/native.md`, "How it's built"). One iOS app holding both navigation approaches:

- **Spike A** (`web/a.html`, `web/a.js`): one WKWebView, a JS stack per tab, Web Animations push/pop, and a JS edge
  swipe.
- **Spike B** (`SpikeB` in `Sources/Spikes.swift`): UITabBarController + UINavigationController, each screen
  borrowing a WKWebView from a pool (`web/b.html`).
- **Probe** (`web/probe.html`): what the `ifizbox://app` scheme and the bridge can do.

Both spikes share a 30k-row virtual list (`web/list.js`), the bridge (`web/bridge.js`, `Sources/Bridge.swift`) and a
frame meter. The meter records the page's rAF intervals (`web/meter.js`) and the app's CADisplayLink
(`Sources/Meter.swift`).

## Build (Linux)

    SWIFT_TOOLCHAIN=~/swift-6.4.2 IOS_SDK=/path/to/iPhoneOS.sdk native/spike/build.sh    # → native/spike/build/iFizBoxSpike.ipa

What it needs and why each flag is there: the comments in `build.sh` and docs/native.md, "Building on Linux".
The IPA is unsigned and runs on a stock phone (no jailbreak needed): sideload it with any signer, e.g. Feather,
AltStore or SideStore.

## Trace on a desktop

    CHROMIUM=/usr/bin/chromium NODE_PATH=~/.local/share/mise/installs/npm-playwright/latest/node_modules \
      node native/spike/trace/trace.mjs
    GDK_BACKEND=x11 python3 native/spike/trace/trace_webkit.py

Both run `trace/scenario.js` against `web/` over a local HTTP server and print JSON (rAF intervals per phase).

## On a phone

The menu has the protocol: Auto, 10 edge swipes, 10 flings, with the "prefer 60 fps" switch on and off. Results
shows the table and shares `spike-results.json` (also in the app's Files folder).
