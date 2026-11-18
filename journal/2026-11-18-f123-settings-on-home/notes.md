# F123 Settings at the bottom of Home, like Cydia

## What changed
- `router.js`: Settings is not a tab-bar tab any more. `BAR_TABS` is Cydia's five (Home, Sources, Changes,
  Installed, Search). `TABS` still has `settings` because its screen draws the pages. Settings' pages are Home routes
  under a plain `settings` segment: `settingsRoute(path)` gives `#/home/settings/<…>`. `parse` rewrites `#/settings/…`
  (old links, bookmarks, and any `format({ tab: "settings" })` another branch adds) to that form, and `sync`'s
  replaceState fixes the URL. `mounted` hands `home/settings/…` to the Settings screen. `mountLink`: a Settings page
  linked from another tab (a package's "Set iOS Version" in Sources/Search) opens as `~settings/<page>` on that tab's
  stack (the user's 2026-11-17 rule: a link keeps the current page, and Back returns). Settings' root from another
  tab switches to Home.
- Why a plain `settings` segment instead of a `~settings` mount on Home: `prefixes` skips mount segments, so
  `#/home/~settings` would have no root Settings page in the stack. With `home/settings/signing` the stack is
  Home > Settings > Signing, and a deep link builds all three.
- `app.js`: the tab bar, the per-tab stacks and the nav stacks use `BAR_TABS`. Every screen's `init` (Settings'
  too) still runs over `TABS`. On the locked website `OPEN_TABS` is now Home only, because Settings is reached
  through Home.
- `home.js`: `homeLinks()` is Home's bottom list, with Settings in its own group above Credits. On the locked website
  that group stays unlocked. The Signing tile, and on the locked website the full-width Signing row, now show only
  while `signingSetUp(mode)` is false. On the website that means `signingReady()` (p12 + profile saved, password
  right). In the sideload app it means the walkthrough's `missingStep(status, getServer())` is null (certificate on
  the device and an https Signing Server). Home asks on render, on Reload, and each time the hash comes back to
  `#/home`, which covers Back from Settings > Signing. The tile starts hidden until the answer comes, so a set-up
  phone never sees it flash. The cost: on a phone that isn't set up it appears a moment after Home draws (about
  40 ms in headless Chromium).
- Every `format({ tab: "settings", path })` in the screens became `format(settingsRoute(path))`: signing-sheet,
  signing-client (no_identity / no_server's Open Settings, firstInstallCheck), account, browse, myipas, settings,
  queue (Console Logs), home. No notification routes to Settings (the native ones all use `#/changes`).
- Tests: router.test.js (tab list, parse/format/mounted/mountLink/prefixes/parent for Settings, a router walk, stacks
  on Home), home.test.js (Settings row above Credits, Signing tile visibility and `signingSetUp` for both modes, a
  scan that no screen links `tab: "settings"`), plus updated old expectations in home.test.js and siteinstall.test.js.

## Tried / found
- Headless Chromium with `--virtual-time-budget` never resolves IndexedDB, so the Signing tile and Settings > Signing
  came out blank in screenshots. With `--timeout=5000` both render. This is the screenshot setup, not the app.
- Screens checked in headless Chromium (390 px, website, locked): Home has five tabs, the Signing tile (no
  certificate), and the Settings row unlocked above Credits. `#/home/settings` shows Settings with Back reading
  Home. `#/settings/signing` is rewritten to `#/home/settings/signing` with Back reading Settings and the Home tab
  selected.

## Not verified
- On the iPhone (the website as a Home Screen app, and the sideload/jailbreak app): no phone for this task. The user
  checks there, as the task says.
- The sideload app's tile hiding after a real certificate import plus server: only checked through `signingSetUp`'s
  unit test with a fake signing.status. The bridge isn't there in a browser.
- The slide animation from Home's Settings row to Settings, and the edge swipe back: not checked in a real browser
  session. Headless screenshots only show the state after loading.
- `ios6.css` still has the Settings tab's gear glyph rule. Nothing uses it now. I left it alone so this branch
  stays small.
