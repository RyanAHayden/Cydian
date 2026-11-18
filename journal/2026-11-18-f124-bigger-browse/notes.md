# F124 A bigger Browse with more ways in

User 2026-11-18: "browse should be bigger and have more categories like new and such".

## What changed
- **Home** (`screens/home.js`): Browse is now its own full-width row, taller, with a second line ("New, Updated,
  Popular, Categories"). It uses the `stack` tile, the same as the Cydian App card. Install IPAs used to sit beside
  it and now has a full-width row of its own just below. That row is locked on the website along with Browse.
- **Browse's page**: a group of Cydia-style lists comes first: New, Recently Updated, Popular, Featured, Free Apps,
  Free Tweaks, Free Themes. The merged categories with their counts follow. While Not Jailbroken the page leaves
  out Free Tweaks and Free Themes (`browseListsFor`), the same way the catalog already left out Themes and Tweaks.
- **Routes**: `browse/<list id>` (`core/catalog.js BROWSE_LISTS`). `browse/popular` keeps its URL, so Home's
  Featured tile still links there. `browsePage` now returns `{ page: "list", value }` for every list, Popular
  included, and the test was updated to match.
- **Each list, and each category page too, has a grey search bar** (`browse.js renderSearchableList`). It filters
  as you type on name, id, description and author (core/changes.js `filterRows`, the same as Changes). Free lists
  and categories are A–Z with the index; the search bar stops 24px short of the index, as on Installed
  (packages.css). New and Recently Updated get a header per day ("Today", "Yesterday", the date).
- **Data** (`core/catalog.js`, pure, node-tested):
  - `freshLists(records, rows)`: New and Recently Updated come from the Changes tab's IndexedDB records and the
    sources' own version dates (AltStore `versions[].date`). The rules match `dayGroups`: undated records from the
    first refresh are the archive and never count as new; a package is new when its candidate is the first version
    ever seen, and updated when an older one came before. Both lists are newest first, cover the last 30 days
    (`FRESH_DAYS`) and keep at most 100 rows. Without IndexedDB, `catalog.fresh` uses only the dated versions the
    worker's `versions()` returns.
  - catalog `free(kind)` (apps / tweaks / themes, by `freeKind`, paid rows left out, sorted by name) and
    `featured(refs)` (refs in order, each package once, the banner source's own version, hidden and unfit packages
    left out). Both go through `runCatalog`, and `web/app/catalog.js` wraps them (`free`, `featured`, `fresh`).
  - Featured = every `sileo-featured.json` banner of every APT source (`extras.js featuredRefs`, round-robin like
    Home's strip), followed by each AltStore source's `featuredApps`.

## Decisions (unattended run)
- "Free Apps / Tweaks / Themes" means Free Apps, Free Tweaks and Free Themes. Plain Tweaks and Themes already
  appear among the categories underneath, so the free lists are the new part.
- Apps = AltStore IPAs, plus APT packages in an app section (`sectionGroup` "Apps").
- New and Recently Updated reach back 30 days, while the Changes tab covers 7. Browse is for discovery, and a week
  is often empty.
- Popular is unchanged (most sources first).

## Checks
- `node --test web/app`: everything passes, including the new `core/browse-lists.test.js` (each list's contents and
  order, the device-type rules, the first-load archive, dated AltStore versions, the 30-day window) and the
  updated `screens/home-browse.test.js` (list order, routes, titles, day headers).
- Rendered in headless Chromium at 390×844: a static server plus a fake `/api/fetch` that answers every repo with
  `testrepo/` (`tools/fakeproxy.py`, `tools/shots.mjs`, `tools/cdp.mjs`). Shots
  are in `shots/`: Home (Rootless; Not Jailbroken looked the same apart from the Cydian App line), Browse, New with day headers, Free Tweaks before and after
  a search. No exceptions.
- What failed along the way: on the first render the A–Z index ran over the list's search bar. Fixed with the
  padding rule Installed already uses.

## Not verified
- On the iPhone (app and website): the user checks it there, as the brief says. I can't drive their phone, and the
  4S/7 are off limits for this task.
- New and Recently Updated against real sources over several days: the shots used testrepo, whose AltStore dates
  happened to fall inside the window. The APT path (records from refreshes after the first) is covered only by
  node tests.
- Featured with real `sileo-featured.json` banners: the fake proxy has none (404), so the page drew only the
  AltStore featured apps. The banners → rows path is node-tested through `catalog.featured`.
- Dark theme and the 4S (320 px) size were not shot. The page uses existing components (grouped table, search bar,
  package list) that already have dark styles.
