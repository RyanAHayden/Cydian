# F79: Install IPAs page rework

## What changed
- `web/app/screens/myipas.js`: the My IPAs library (#/installed/myipas) is now **Install IPAs** (grouped page):
  - **Browse** first: Search Apps, All Apps (count), then the Browse categories (core/catalog.js `mergeCategories`,
    `jailbroken: false`) of the AltStore apps only. Apps are the catalog rows with `kind: "ipa"` (`appsOf`), filtered
    in the screen, so core/catalog.js is untouched. New routes below the page: `myipas/search`, `myipas/apps`,
    `myipas/category:<name>`, and browse.js's own pages (an app's page, Version History) below those.
  - **My IPAs** under it: the user's IPAs as a grouped section (same icons and state classes as before); the empty
    text is the section's footer.
  - Add (nav bar) as before; its action sheet now says **Files / From URL** (the old "Browse" button was the Files
    picker, and "Browse" now names the page's own section). On the website Add is From URL only, as before, and
    Install signs through the Signing Server (unchanged code path).
  - Search Apps: Search's grey bar (packages.css), results from `catalog.search` filtered to apps, browse.js rows.
  - Browse recounts on `catalog.onChange` (a refresh or a new source).
- `web/app/screens/home.js`: an **Install IPAs** tile beside Browse (halves row), `ipasTile(mode)`; none in the
  jailbreak app, whose Installed tab has no such page.
- `web/app/screens/installed.js`: the tile button keeps its look, label now "Install IPAs" with a "Browse apps, or …"
  subtitle.
- `web/app/home.css`: no change needed (the tile reuses `.home-row.halves` and `glyph-install`).
- Tests: myipas.test.js (the page's routes, titles, Browse groups, apps-only filter, empty texts), home.test.js
  (`ipasTile`), installed.test.js (the label).

## Decisions (unattended)
- Kept the route `#/installed/myipas` so incoming .ipa links (incoming.js) and F77's IPA pages keep working; Home
  links across tabs to it, as its Themes and Signing tiles already do.
- Search is its own page (pushed from Browse's first row) instead of a bar on the grouped page: a virtualised result
  list doesn't mix well with grouped sections on one page.

## Checked
- `node --test` on the three test files: pass.
- Headless Chromium renders (site mode, 390px): Home shows Browse | Install IPAs; Installed's tile says Install IPAs;
  Install IPAs shows Browse (Search Apps, Loading Apps) then My IPAs with the site's empty text; Search Apps shows the
  bar and hint.

## Not verified
- Browse's categories and the category/All Apps lists with real AltStore sources: in headless Chromium here
  `catalog.ensure()` never finished (Home's existing Browse page stays on "Loading Packages" the same way, and no
  fetch reached the proxy), so only the loading state was seen. The groups are covered by the node test.
- The sideload app (Files picker, signing) and the user's iPhone: no device here; the task says the user tries it.
