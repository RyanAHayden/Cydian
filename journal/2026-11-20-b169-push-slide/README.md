# B169: Install IPAs and What's New slide in like every other page

## What was wrong

Two separate causes.

1. **Install IPAs (Home tile, `#/installed/myipas`).** On a fresh start it already slid in: the router mounts it on
   Home's stack (`#/home/~installed/myipas`). But the router told a Back from a new link by comparing the new hash with
   the one before it (`seen.at(-2)`). If you opened Installed > Install IPAs, switched to Home with the tab bar, then
   tapped Home's Install IPAs tile, the tile's raw hash `#/installed/myipas` matched the entry before Home. The router
   took it for a Back, skipped the mount and jumped to the Installed tab with no slide. Reproduced in Chromium on HEAD
   (served from a scratch worktree): `after #/installed/myipas moves 0 slideMs []`.
2. **What's New (Home's green tile: See What's New / Everything Up to Date / N Upgrades Available, `#/changes`).** A
   link to a tab's *root* was always a plain tab switch (`mountLink` returns null for an empty path), so Changes never
   slid in. Help's "Check for Changes" did the same.

## What changed

- `router.js`: every history entry the router lands on gets `history.state = { ifizboxStep: n }` (rising). A hash
  change onto an entry that already has a step is a back/forward walk (back when its step is lower). One without a
  step is a new link, so it is never taken for a Back. `replace()` keeps the entry's step. Windows without
  `history.state` (router.test.js's stub) keep the old hash comparison.
- `router.js`: `rootOn(tab, on)` builds a tab's root pushed on another stack (`#/home/~changes`). `prefixes()` now
  counts a mount segment at the *end* of a route as a page (that tab's root). In the middle it is still no page.
- `home.js`: `CHANGES_HREF = format(rootOn("changes"))` for the green tile's three Changes states, and
  `rootOn("changes", Help)` for Help's Check for Changes.
- `changes.js`: Changes' root can now be on screen twice (its tab and on Home), and its module `state` follows the
  copy drawn last. `redrawCopy`, an `onPageShow` hook, redraws a copy that comes back to the top while the other one
  holds the state.
- I left `mountLink` alone for tab roots on purpose. Changing it would also turn `ifizbox://<tab>`
  (B14: "that tab, at its root"), the notification's `#/changes`, the Upgrade All shortcut and the tab bar's own
  hrefs into pushes.

Test: `web/app/push-kind.test.js` (new). Its fake window has a browser-like history with `state`. It pins the push
kind for Install IPAs (fresh, and after an Installed > Install IPAs visit, which failed before the fix), for all three
What's New states, Help's Check for Changes, a Changes row from the mounted Changes, back/forward, reload and replace.
It also checks that the tab bar still switches tabs.

## Checked in Chromium

`serve.mjs` + `probe.mjs` here (headless Chromium, iPhone UA, real mouse events. The tap guard ignores `el.click()`,
and the site needs `ifizbox.firstVisit=later` or Home's tiles are locked):

| case | site | app (fake bridge, jailbreak) |
| --- | --- | --- |
| Install IPAs, fresh | slides 380 ms, Back slides | slides 377 ms, Back slides |
| Install IPAs after Installed > Install IPAs, Home tab | slides 380 ms (HEAD: jumps tabs) | slides 380 ms (HEAD: jumps tabs) |
| What's New tile | slides 378 ms, Back slides | slides 394 ms, Back slides (mid-slide shot looked right) |
| Changes tab after Home > What's New > Back | - | drawn, list/note present |

Run: `node serve.mjs web/app 8169`, then `PRE='[...]' node probe.mjs "http://127.0.0.1:8169/#/home" "a.home-tile" "Install IPAs" '<bridge js>'`.

## Follow-up

B172: the other links that open a tab's root still switch tabs: the green tile's Loading/Failed states and Help's
Refresh Sources (`#/sources`), Find Extensions (`#/search`), and Guides' Refresh Sources and Installed. Those screens
keep module-level state for their root body like Changes did, so each needs the same two-copy care first.

## Tried and dropped

- Changing `mountLink` so every link to another tab's root mounts: too wide (see above).
- Fixing only Home's Install IPAs href (`#/home/~installed/myipas` directly): it would have left the router's
  link-taken-for-Back bug in place for every other cross-tab link (Guides' Install IPAs, Settings links from other
  tabs).

## Not verified

- **On a phone (iPhone 7 app, iPhone Safari site).** Not run. The 7 needs a fresh .deb build of this branch and the
  ui-7 lock, and other slots overwrite its .deb. Chromium covers the routing and the WAAPI slide, which are the same
  code. iOS Safari's and WKWebView's `history.state` on hash navigation follows the standard: a new entry has null
  state, and a back restores it. I have not watched it on device.
- **Real native backend.** The app runs used a fake bridge that answers null to every call. Install IPAs with a real
  library and Changes with real upgrades were not drawn.
- **iOS's own edge-swipe back on the website.** It walks history like `history.back()`, so it should hit the same
  step logic. Not tried, because Chromium has no such gesture.
