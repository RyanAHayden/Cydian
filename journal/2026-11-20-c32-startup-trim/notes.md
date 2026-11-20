# C32: trim the rest of startup after F313

app.js's static import closure: **123 modules, 1.55 MB -> 114 modules, 1.34 MB** (module-graph.test.js
MAX_MODULES 124 -> 117). The brief said 104 / 1.52 MB; by the time this ran (after C28 split signing-client.js into
14 files) it was 123.

## What moved

- **core/tweakfields.js** (new, 85 lines): `injectableFromFields`, `isLibraryStanza`, `countInjectable`,
  `TWEAK_ARCHES`, `HOOK_DEPS`, `LIBRARY_WHY` and the private `OK_DEP`, `THEME_DEPS`, `BAD_SECTION`, `BAD_PURPOSE`,
  library-description walk, cut from core/tweaks.js unchanged. core/tweaks.js re-exports them, so screens/tweaks.js
  and the tests import them from there as before. core/catalog.js and backend-native.js import from tweakfields.js:
  core/tweaks.js, core/unpack.js (46 KB) and core/sha256.js left startup.
  - Choice: the brief said to make backend-native's `countInjectable` dynamic. Since `countInjectable` is four lines
    that need only apt.js's `parseControl` (already at startup), I moved it into tweakfields.js and kept the static
    import; nothing heavy comes with it and the Sources count stays synchronous.
  - backend-native.js's `decompress` (Packages.bz2/.zst, B177) is now `await import("./core/unpack.js")` inside
    `packagesInJs`, as backend-http.js already did.
- **Website signing** (signing/browser.js and what only it imports: early.js, toobig.js, watch.js, prompt.js, and
  through them core/myipas.js, nav/actionsheet.js, screens/guides.js): the two static edges into it were
  signing/install.js (`signInBrowser`) and signing/password.js (`runInWorker`, `buffer` from early.js). install.js
  now calls `(await import("./browser.js")).signInBrowser(…)` where the site signs; password.js's default worker
  loads browser.js on first use; `buffer` moved to signing/common.js (early.js re-exports it). signing-client.js is
  unchanged and still re-exports every name, so the tests that import signInBrowser etc. from it pass as before.
- **screens/guide-index.js** (new): `GUIDES` (now with the API-key entry in the literal instead of guides.js adding
  it at load), `guideIds`, `guideRows`, `isLite`, `shows`, `JAILBREAK_INFO_URL`, `ASC_GUIDE`, `keepGuideHref`,
  `ascGuideHref`. guides.js re-exports them. home.js draws its User Guides group from it and reaches the guides
  through `lazyNs("guides")`; settings.js takes `keepGuideHref` from it. lazy.js has `guides`; router.js `lazyFor`
  returns `["guides"]` for any #/home/guides… route, so app.js waits for it before the push (and preloads it on the
  press).
- import-cycles.test.js: the one big signing/ cycle (10 files) is now three smaller ones, all inside it; I replaced
  its line with the three. The test says "never add a line": these aren't new cycles, they are what is left of the
  listed one.

## Measured (journal/2026-11-20-f313-lazy-screens/firstpaint.mjs, headless Chromium, `python3 -m http.server`;
before = `git archive HEAD` at 389df316, after = this branch)

| | before | after |
|---|---|---|
| local, median of 7: first page drawn | 95 ms | 83 ms |
| scripts fetched by then | 124 | 115 |
| `--slow`, median of 5: first page drawn | 1782 ms | 1596 ms |
| `--slow`: first contentful paint | 412 ms | 352 ms |
| scripts after the background load | 189 | 187 |

Every route the script opens (each tab, Settings, General, Browse, User Guides, the #/installed/myipas deep link)
draws its title and content with no console errors, on the site and with `--native`.

The background load now leaves out the website signer (it isn't a lazy.js name): the first Install on the site
fetches signing/browser.js and its parts on that tap, behind the HUD that tap opens anyway.

## Gate

`node --test web/app`: 2510 pass, 1 fail (import-cycles, fixed as above), then both graph tests pass. Full gate via
`run done`.

## Not verified

- **On a phone** (Safari on the site, the iPhone 7 jailbreak app, the sideload IPA): not run; no phone in this task.
  Only headless Chromium locally.
- **A cold deep link into a guide** (#/home/guides/faq/app opened as the first page): not opened in the browser; the
  firstpaint script checks #/home/guides after start-up only. lazyFor's test covers the route, and the cold path is
  the one #/installed/myipas takes (checked).
- **A real website install** (signing in the browser after the import()): the unit tests run signInBrowser through
  signing-client.js; no browser install with a certificate was run.
