# F46 Browse from Home

## What I did
- `core/catalog.js`: Browse (F46).
  - `BROWSE_CATEGORIES`: Games, Emulators, Entertainment, Photo & Video, Social, Lifestyle, Utilities, Developer,
    Themes, Tweaks, Other.
  - `browseCategory(row)` maps AltStore's `Apps (<category>)` sections by the category inside, and APT sections by
    their full name and then their simple name. "Emulators" exists in neither format, so a game, utility,
    entertainment or other app whose name or subtitle says emulator/emulation goes there.
  - APT plumbing sections (Libraries, System, Packaging, No Section) are left out of Browse. All Packages still
    lists them. An unknown AltStore category goes under Other.
  - `mergeCategories(rows, { jailbroken })` drops empty categories, and drops Themes and Tweaks (`JAILBREAK_CATEGORIES`)
    when not jailbroken.
  - `rankPopular(items, limit)`: number of sources listing the id first, then the newest update (AltStore candidate
    `date`; APT has no dates), then name. The limit is 50.
  - Catalog methods `categories()`, `browse(category)` and `popular({ limit })` work over `visibleOf(ALL)`, so hidden
    sections, the Works on My Phone filter and Not Jailbroken (appsOnly) all apply. They are wired through
    `runCatalog` and the `web/app/catalog.js` client.
- `screens/home.js`: a full-width Browse tile under Featured/Themes (orange grid glyph in `home.css`).
  - Routes: `home/browse` (Popular row, then Categories with counts), `home/browse/popular` (ranked list, no letter
    headers), `home/browse/category:<name>` (A–Z list).
  - Anything deeper is handed to `browse.js` (package pages, author, versions), as Search does.
  - `browse.js` only gained `export` on `renderList`.
- Tests: `core/browse-home.test.js` covers the merge, the ranking, the catalog ops and Not Jailbroken.
  `screens/home-browse.test.js` covers the routes and page groups. Both are new files, to keep merges clean.

## Decisions
- Popular counts the sources that list a package, as the brief allows, because real install counts don't exist yet.
- Browse sits on its own row, so the Featured | Themes row (F41) stays as it was.

## Tried, failed
- I tried screenshots of Browse with headless Chromium against the Flask app. Home and the Browse tile rendered.
  The Browse page stayed on "Loading Packages": no fetch reached Flask, because `catalog.ensure()` never got past
  the worker/IndexedDB start in headless with `--virtual-time-budget`. I did not dig further.

## Not verified
- The Browse, Popular and category pages with real sources in a browser or on a phone. The headless run above
  never loaded sources, and the task says the user tries it. The logic behind them is covered by node tests.
- How well the categories split real repos (Chariz, Havoc, real AltStore sources). This was checked against
  fixtures only, with no network fetch of real indexes.
- The 4S, and a 3x zoomed render of the new glyph. The glyph is a simple four-square SVG in the same style as the
  others.
