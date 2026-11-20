# B189: the bridge answers the app's page only

## What was wrong

`Bridge.userContentController` never looked at `message.frameInfo`. `addScriptMessageHandler(_:contentWorld:name:)`
has no main-frame-only option: WebKit gives `window.webkit.messageHandlers.ifizbox` to every frame, and the
`sandbox` attribute on the depiction iframes doesn't hide it. A repo's HTML depiction (browse.js
`openHtmlDepiction`) or Sileo `DepictionWebView` (depiction.js) could call any bridge method: `helper.run`,
`signing.*`, `account.key.get`, `asc.request`.

## Confirmed on the iPhone 7 first

- A test APT repo served through `ssh -R 8711` (docs/iphone7.md): one package, `com.ryha.b189test`, whose
  `Depiction:` was a page that posts `{method: "ping", params: {i: 189}}` from the iframe and prints the answer.
- Installed build 0.9.9-1957 (no fix): Package page > Depiction showed `ANSWERED: {"pong":189}`. The iframe
  reached the bridge (screenshot `ref/7/screens/b189-before-fix.png`, main checkout's ref/).
- Built this branch (`native/build.sh deb`, 0.17.0-2620), installed it with apt, grepped the installed binary for the
  new refusal string (1 hit), opened the same depiction: `REFUSED: Error: refused: not the app's page`
  (`b189-after-fix.png`). The app's own page still worked: the package page, Sources and the source delete all
  go through the bridge.
- Cleaned up: deleted the B189 Test source in the app (the sources file no longer has the 8711 stanza), stopped the
  server and tunnel, removed `/tmp/b189.deb`. The phone keeps the newer 0.17.0-2620 build (other tasks reinstall as
  they need).
- Side finding: at the start iFizBox wasn't registered with LaunchServices (`uiopen --bundleid` exited 1 and
  `ifizbox://` opens did nothing, though the .app was in /var/jb/Applications). `uicache -p
  /var/jb/Applications/iFizBox.app` fixed it. Probably some earlier task's install or removal; not chased.

## The fix

`Bridge.fromApp(_ frame: WKFrameInfo)`: main frame **and** `securityOrigin` protocol `ifizbox` (AppScheme.scheme)
**and** host `app`. The handler's first statement refuses anything else with `refused: not the app's page`, before
it reads the body or looks up a method. An opaque origin (sandboxed frame, data:) has no such scheme or host.
The spikes (native/spike) also load from `ifizbox://app`, so they are unaffected.

Comments at browse.js `openHtmlDepiction` and depiction.js `DepictionWebView` corrected: the sandbox keeps the
frame off our origin and storage, not off the bridge; the shell's check does that.

Gate: `native/test_bridge_frames.py` checks that fromApp tests all three conditions with `&&`, that the handler's
first statement is the fromApp guard, and that App.swift is the only place adding a script message handler.

## Not verified

- The sideload build on a stock iPhone: same Bridge.swift and the same `ifizbox://app` page, so the same check runs,
  but no stock phone test was done (no task ask, and the iPhone 15 is read only).
- A Sileo `DepictionWebView` iframe on the phone: tested the HTML depiction sheet only; both are iframes, and the
  check is on the frame, not on which screen made it.
