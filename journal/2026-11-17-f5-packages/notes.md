# F5: Sections, package lists, Search and the package page

## What I did

- `web/app/core/catalog.js` (new, pure): the package catalog.
  - `sectionName`: `_` → space, then Cydia's `Sections.plist` (all 42 fixes, read off the 4S); English
    `Sections_.strings` maps every name to itself, so there is no localisation step. Empty → "(No Section)".
    Also `simpleSection` (Cydia's Simplify), `parseAuthor` ("Name <mail>"), `isVisible` (hides `cydia::obsolete`
    and `role::` other than enduser/hacker/developer), `indexLetter` (A–Z, accents folded, else "#").
  - `createCatalog()`: `load(key, text, root, arch)` keeps packages for the arch (core/apt.js `matchesArch`, the
    same rule as `filterArch`), visible ones only, the newest version per id within a source. "All Sources"
    (`*`) merges by id, newest version wins (dpkg order), first source on a tie. `sections`, `list`, `search`,
    `author`, `package` (with the versions other sources carry), `has` (for linking Depends).
  - Search: every word must be in name, id, short or long description, Author or Maintainer; ranked exact
    name/id, then prefix, then inside name/id, then author/maintainer, then the rest; by name within; 2000 max.
- `core/worker.js` / `core/parser.js`: the catalog lives in the parse worker; `parser.catalog(op, args, input)`.
  So parsing, grouping, sorting and search never run on the UI thread.
- `web/app/catalog.js` (new): feeds the worker every source's Packages (each component's index joined) for
  `getArch()`, and forwards the screens' questions. Cydia's model: the lists change on a refresh. Each index's
  text is kept in IndexedDB (core/cache.js, key `packages:<dir>`) and reused while newer than the source's
  `updated` (set by Sources → Refresh/Add); a source refreshed since is refetched. A source whose last refresh
  counted 0 for this arch (Telesphoreo, rootless) isn't fetched.
- `nav/vlist.js` (new): virtualised plain table. Rows absolutely placed in one tall spacer, moved by transform,
  recycled from a pool (hidden, not removed); 600 px overscan; letter headers are rows too, and one CSS-sticky
  copy shows the current letter and is pushed up by the next. Icons load only after scrolling stops (120 ms),
  unless that URL already loaded once.
- `screens/browse.js` (new): the pages under Sources and Search. Routes: Sources `#/sources/<key>` (or `*`,
  All Sources) = Sections; then tokens `section:<name>` (`section:*` = All Packages), `package:<id>`,
  `author:<name>`; the Search tab uses the same tokens.
  - Sections: Cydia's SectionsController: "All Packages" first, then sections by name, each with a redrawn
    folder (Cydia's `folder.png` decoded from the 4S for reference only: flat `#8e8e93` square, white folder)
    holding the count. 46 px rows, name 18 pt.
  - Package rows (58 px): 32 px icon (http(s) `Icon:`; a letter tile tinted by section until then: Cydia's
    section icons and unknown.png are its artwork), name, version, short description, chevron.
  - Package page: header (64 px icon, name, version, size), Author (and Maintainer if different; "Contact"
    when there is no Author, as Cydia), each opening that person's packages; SileoDepiction JSON rendered
    natively inline; otherwise the description, plus a "Depiction" row that opens the HTML depiction in a sheet
    and "More Information" (Homepage); Details (version, size, installed size, section, id, arch); Depends and
    Pre-Depends (a line links to the first alternative we carry); Conflicts; Source (and other sources'
    versions, linking to that source's copy); Download .deb on the site; footer id / source · section.
  - Download .deb: `backend.assetUrl(debUrl)` (`/api/fetch?url=…`) with a `download` filename; only when
    `backend.kind === "http"`. Hidden for `cydia::commercial` packages (Havoc answers the proxy 418 for a paid
    deb), with a note instead.
  - HTML depictions: sandboxed iframe in a sheet (`allow-scripts allow-popups allow-forms`, no
    `allow-same-origin`, no bridge). An http depiction on the https site would be mixed content, so there it
    comes through the proxy as `srcdoc` with a `<base>` and scripts off.
- `screens/depiction.js` (new): Sileo views (TabView with a segmented control, Stack/AutoStack/Layer, Header,
  Subheader, Label, Markdown, Image, Screenshots, TableText, TableButton, Button, Separator, Spacer, Video as a
  link). Nothing is injected as HTML: markdown is parsed into DOM (headings, lists, bold, italic, code, links,
  images, rules); `useRawFormat` HTML goes through an allowlist rebuild. Links only http(s)/mailto;
  `depiction-https://…` opens the sub-depiction natively in a sheet. Images: https direct, http via the proxy.
- `nav/sheet.js` (new): iOS 6 modal sheet (slides up, own blue bar, Gloss Blue Done, Escape).
- `screens/search.js`: the kit's "grey search bar" (colours from `sheet.svg`: `#b5b9bd`/`#d3dbdf`/`#b3bdc5`,
  `#81919f` line, 30 px field, `#7b8fa3`→`#a3afb9` edge, `#93979d` magnifier, `#b4b3b4` placeholder), debounced
  120 ms, results ranked (no letter headers).
- `screens/sources.js`: the "All Sources" row (section 0, folder, "combined package list for below sources")
  above "Individual Sources"; a source opens its Sections; F4's placeholder Source Information page is gone.
- `packages.css` (new, linked in index.html) holds all the styles; dark theme follows the F13 variables.
- **Bug fixed in `style.css`** (one line): every `.tab-stack` and `.nav-stack` covers the whole screen, and the
  later tabs' empty stacks sat on top of the earlier ones, so hit-testing found them first.
  `document.elementFromPoint` on a Sources row returned `DIV.tab-stack`. On a phone, taps and touch scrolls on
  every tab but Settings would have gone nowhere (F4's checks clicked through JS, which hides this). Now
  `.tab-stack, .nav-stack { visibility: hidden }`: only their visible pages and items take hits. After the fix
  a real CDP touch tap on All Sources opens it, and Refresh and Edit are hit.

## Decisions

- Package lists are sorted by name with A–Z headers ("#" for the rest): that is how Cydia's package lists are
  indexed. I couldn't confirm Cydia's own label for non-letters; "#" is the iOS convention.
- Search runs on the whole merged catalog (All Sources) and caps at 2000 results (typing "a" still answers in
  18 ms).
- The package page title is the package name. A deep link shows the id until the worker answers, then the nav
  bar title is replaced. The next page's back button keeps whatever title the page had when it opened.
- No install/queue buttons (later tasks); no Section Visibility edit mode (filed as F24); no Release
  `Depiction:` template fallback (filed as F25).
- Package icons: https loads directly (an `<img>` needs no CORS); http goes through the proxy, which costs
  rate-limit budget (filed as B3).

## Checks run

- `node --test web/app`: 74 pass. New `core/catalog.test.js` (section names and Sections.plist fixes; authors,
  visibility, letters; arch filter, newest version, hidden packages; section grouping with counts and order;
  All Sources merge and dpkg order 1.10 > 1.2; search on name, id prefix, short and long description,
  maintainer, ranking, limit; author lists; reload/remove; the worker's catalog op with bytes, and the inline
  parser fallback) and `screens/browse.test.js` (routes and a `deb:` key surviving the hash round trip, titles,
  sizes, letter headers, `withBase` escaping).
- Live in headless Chromium 155 (CDP, 390x844 @3x, touch emulation) against `web/app.py` with real network.
  Scripts are in `tools/` (`drive.mjs` runs a script against a page; `shots.js`, `fling.js`):
  - Rootless: All Sources has 696 packages in 11 sections (BigBoss 240 + Chariz + Havoc). Chariz Tweaks list,
    sticky letter header, Bridge (Havoc) with its Sileo depiction (header image, Details/Changelog tabs,
    screenshots), a free package's Download .deb: the proxied URL answers 200 with an `ar` archive (`!<arch>`).
    The paid Bridge gets the note instead.
  - Rootful (`cydia.arch = iphoneos-arm`): BigBoss All Packages, then search "winterboard" → WinterBoard →
    Depiction (https://cydia.saurik.com/info/winterboard/ in the sandboxed sheet; Done closes it) → Author
    "Jay Freeman (saurik)" → 21 packages.
  - Search in the worker over the rootful All Sources catalog (BigBoss's 9,974 plus the others): "a" 2000 hits in 18 ms; "theme" 1077 in 2.6 ms; "ryan petrich"
    97 in 1.2 ms (author field); "zzzzzz" 0 in 0.5 ms.
  - Sources edit mode: 5 delete toggles for 5 sources, none on All Sources.
- **Fling trace** (`tools/fling.js`): ten fast touch flings (480 px of finger travel in ~50 ms each, re-flicked
  while coasting; up to ~16,000 px/s) with a Chrome trace and a per-frame blank-gap check:
  - **BigBoss, rootful** (9,974 packages: today's index, not 30k): 545 frames, 0 dropped (max interval 16.8 ms
    at headless Chromium's 60 Hz), **0 frames with blank space**. Main-thread tasks max 2.19 ms (p99 1.14 ms),
    none over the 8.3 ms 120 Hz budget. vlist update (rAF) p99 0.12 ms; Layout max 1.43 ms; Paint max 0.39 ms.
  - **Synthetic 30,000 rows** through the same `packageList` (1.74M px list): 548 frames, 0 dropped, 0 blank,
    main-thread max 4.68 ms (p99 1.09 ms), Layout max 0.34 ms.
  - The raw trace (`fling-trace.json`, ~MBs) isn't committed; `tools/fling.js` regenerates it.
- Screenshots here: `sources.png` (Telesphoreo's fetched icon is Cydia's logo, so it was removed from the page
  before the shot), `sections-all-sources.png`, `sections-chariz.png`, `list-chariz-tweaks.png`,
  `list-sticky-header.png`, `package-sileo-depiction.png` (cropped above the depiction's screenshots: they show
  Apple's app icons), `package-bottom.png` (Download .deb),
  `package-bottom-paid.png`, `dark-package-bottom.png`, `dark-search.png`, `search-author-query.png`,
  `html-depiction-sheet.png`, `author-list.png`.

## Tried and dropped

- `Input.synthesizeScrollGesture` with `gestureSourceType: "touch"` doesn't scroll at all in headless Chromium
  (mouse does). The first trace "passed" with scrollTop 0. Raw `Input.dispatchTouchEvent` moves fling with
  momentum, so the trace uses those and prints scrollTop after each fling.

## Not verified

- **120 Hz on a real iPhone**: headless Chromium caps rAF at 60 Hz and isn't WebKit. The trace shows the
  per-frame work (max 4.7 ms) fits an 8.3 ms frame, but ProMotion, WebKit's async scrolling (scroll events lag
  the compositor during momentum, so the 600 px overscan is what keeps rows ahead) and iOS memory for the 1.7M px
  layer weren't checked. No iPhone with a modern iOS here; the 4S (iOS 6) wasn't asked for and can't run this.
- **The 30k-package source**: BigBoss's index has 9,974 packages today (its iphoneos-arm Packages file holds
  9,974 stanzas, all unique). The 30k figure was checked with synthetic rows only.
- **http depiction on the https site** (proxied `srcdoc`): the local server is http, so the direct-iframe path
  ran; the mixed-content branch ran only in the `withBase` unit test, never in a browser.
- **In the app** (`backend-native.js` doesn't exist yet): browse.js needs `text`, `packages`, `sources` and
  optionally `assetUrl` from the backend; Download .deb shows only on `kind === "http"`.
- **Procursus**: still 403 to the server (F4's note), so its Sections show that error; not checked further.
- **Depiction headers** Cydia sends (`X-Machine`, `X-Cydia-Cf`) can't be set on an iframe or `<img>` from
  a page; depictions that check them may look different. Not checked against any such repo.
- Icons of packages with `file:///` icons (installed apps) show the letter tile on the site; the app could
  show them, which is N-task work.
- Changing the arch in Settings reloads the catalog on the next visit, but a source whose last refresh
  counted 0 (for the old arch) stays empty until Sources → Refresh.
- docs/native.md and docs/cydia.md weren't updated (outside this task's files); this file and the headers of
  `core/catalog.js` and `screens/browse.js` document the routes and calls.
