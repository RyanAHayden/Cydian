# F313: lazy-load heavy screens

## Result

app.js's static import closure: **169 modules, 2.74 MB → 104 modules, 1.52 MB** (`web/app/module-graph.test.js`
holds it under 110 and keeps every lazily loaded module out of it).

First page on the site (`firstpaint.mjs`, headless Chromium, iPhone UA, 402x874 @3x, cache off, served by
`python3 -m http.server`; before = `git archive HEAD` of main at 8eb7c192, after = this branch):

| | before | after |
|---|---|---|
| local, median of 7: first page drawn (#boot gone) | 113 ms | 78 ms |
| local: scripts fetched by then | 170 | 105 |
| `--slow` (4x CPU, 40 ms latency/request), median of 5: first page drawn | 2002 ms | 1610 ms |
| `--slow`: first contentful paint (the static loading screen) | 268 ms | 352 ms |
| scripts after the background load (all of them) | 188 | 189 |

First contentful paint is the loading screen in index.html, before any module runs; it came out later with
`--slow` in every run (264–296 vs 332–352 ms). I don't know why; it isn't the app's first page. The first page
drawn is what the task is about, and it is 20–30% sooner.

The win under `--slow` is smaller than the module count suggests: there the time goes to the import chain's depth
(each level waits a round trip), which this didn't shorten much.

Push from Home (`push.mjs`, the Browse tile):

- with screens/browse.js held back 800 ms by CDP Fetch, tapped right after Home drew: the page appears 822 ms
  later, already drawn (6 children in its body) and sliding. No empty page slides in.
- tapped in the first frame after Home drew, nothing held back: 45 ms after: 14 ms before (Browse was still loading).
- tapped 2 s after Home drew (the background load done): 14 ms, same as before (13 ms).

Every route checked by firstpaint.mjs (each tab, Settings, Settings > General, Browse, User Guides, a deep link to
#/installed/myipas) draws the same title and content as before, with no console errors, on the site and with
`--native` (a stand-in jailbreak shell that answers null).

## How

- `web/app/lazy.js` (new): the registry of modules loaded on demand: the other tabs (Sources, Changes, Installed,
  Search, Manage), Browse / Tweak Roulette / extras, and Settings' parts (account, devaccount, free-apple-id,
  importlink, signed-apps, website-settings, push-settings, queue, ipa-install). `load(name)` (async),
  `mod(name)` (sync, throws `NotLoaded`), `lazyNs(name)` (a Proxy standing in for `import * as x`). Under node, `mod`
  loads synchronously with require(esm), so the ~2400 unit tests that import screens and draw pages straight away
  needed no change. Browsers have no `process` and never take that path.
- `router.js`: `lazyFor(route)`: which of those a route's pages draw with (by the screen each page belongs to,
  through `mounted`); `TAB_TITLES` so the tab bar draws before the tabs load.
- `app.js`:
  - only Home and Settings are static; `screenOf(tab)` reads the others from lazy.js.
  - `onRoute` waits for `lazyFor(route)`'s missing modules before showing a route (a newer route wins), so a push
    slides in drawn; `showRoute` is the old body, unchanged except `initLoadedTabs()` at the start and removing
    `#boot` the first time (so a deep link to a lazy page keeps the loading screen until it's drawn).
  - `drawPage` (split out of makePage, with `navParts`): a page drawn before its module is in (a route lazyFor
    misses) shows the loading placeholder under its tab's title and is drawn again once the module loads (or says it
    didn't load, when the fetch fails).
  - a pointerdown on an `a[href^="#/"]` starts loading that link's modules ahead of the click.
  - once the first page is up (a frame, or 500 ms without one), the other tabs load and run their `init` (Changes'
    badge, Installed's queue chrome), then queue.js's `initQueue` and ipa-install.js's `initIpaLinks`, then every
    other lazy module, so later taps never wait.
  - launch refresh and `/add?url=` load Sources / Manage before calling them.
- `screens/home.js`: Browse and Roulette through `lazyNs`; `featuredRefs` and `refreshInBackground` through `load`.
- `screens/settings.js`, `screens/signing.js`: Settings' parts through `mod()` wrappers (they are only drawn on
  Settings' pages, which lazyFor preloads); account sync at launch through `load`. `LOGS` is a local constant
  ("logs", as queue.js) so every Settings page's title doesn't need queue.js.
- `core/certfiles.js`: asc.js imported dynamically, only when a .p8 key is among the files.

## Not done (filed as C32, low)

The brief named three more that need code moved, which other slots edit, so I left them:

- **core/tweaks.js + core/unpack.js** (91 KB): core/catalog.js uses `injectableFromFields` synchronously in
  `load()` (in the parse worker, and inline on the main thread when there is no Worker), and core/catalog.js is on
  the main thread for `ALL`/`freshLists`. Cutting it means moving that check into a small module.
- **signing-client.js's browser-signing half**: a split moves ~650 lines out of a file many tasks edit, and the
  tests import those names from signing-client.js. It is one module (102 KB) in the count.
- **screens/guides.js**: Home's root draws the User Guides group from `GUIDES`/`isLite`. Making guides.js lazy would
  have the group pop in after the first paint (against the size-changes-slide rule) unless the index moves out.
  why.js stays for the same reason (Home's Why tile).

Even with all three, startup would be ~100 modules; the count of 110 is reached without them.

## Tried / dead ends

- First baseline run hit port 8732, which another agent's node server held (my python server failed to bind), and
  timed out. Re-ran on 18731/18732, checked free first.
- firstpaint.mjs's first version navigated to the same URL each run (a hash change, no reload), so runs 2–5 repeated
  run 1's numbers; each run now adds a `?run=` query.
- One local run showed Sources' root with 0 children 1.2 s after the switch; three re-runs (and base) show 2. Sources
  draws its list asynchronously; I take it as a timing race in the probe, not a regression.

## Not verified

- **On a real phone** (iPhone 7 jailbreak app, sideload IPA, Safari on the site): not run. The task names "first
  paint on the site measured before/after"; I measured with headless Chromium locally (with and without a CPU/latency
  throttle), not on ifizbox.com or an iPhone: the slot has no phone task and the site deploys only after merge.
  WKWebView loading the lazy modules through the app's scheme handler is the same path the existing dynamic imports
  (incoming.js, safety.js, push.js) already use.
- **The real native shell**: `--native` stubs every call with null, so it checks only that the jailbreak path starts
  and draws; the queue's Confirm sheet opening after initQueue moved after the first page was not exercised.
- **drawPage's redraw after a late load** (a route lazyFor misses): not hit in a browser, since every route tried is
  in the map. Its failure branch was (below).

## The fallback, checked

`push.mjs … 0 0 --fail-once` fails the first fetch of screens/browse.js and taps Browse: the page slides in with the
loading placeholder under "Home", then shows "This page didn't load. Check the connection, then reload iFizBox."
A second import() doesn't help: Chromium keeps the failed module for the rest of the document (first try without
the message left the page blank for good), hence the message and no retry. Before F313 a failed module fetch left
the whole app on its loading screen.
