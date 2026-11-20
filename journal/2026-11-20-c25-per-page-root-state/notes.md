# C25: per-page state for roots that can be on screen twice

## What changed

- New `web/app/nav/pageviews.js`: `pageViews(make)` → `{ open(body, init), adopt(body, view), of(body), all() }`.
  One view object per page body. A view is dropped once its body has been in the document and is not any more (the
  page was popped or drawn again); a body never attached (a node test's stub) counts as live.
  It is keyed by the page body, the same key as C23's `handleOf(body)`. I didn't hang the state on the handle itself:
  Installed's views have to exist in `nav()`, before render gets the handle, and the handle is nav/go.js's (outside
  this task's files). Changes keeps its copy's handle on the view (`view.page`).
- **Sources** (`screens/sources.js`): the list data (sources, busy, rows, loading, tried, ctx) stays module-level,
  since it is one list. Each root copy has its own view: search text, search bar and list box. Whatever reloads draws
  every copy (`drawAll`). A row's refresh state is painted in every copy (`rowsOf`). After a swipe Delete, the row
  collapses in the copy it was deleted from and the other copy is drawn again. Removed `redrawCopy` and its `onPageShow`, plus the
  `state.body?.isConnected` / `state.box?.isConnected` guards.
- **Changes** (`screens/changes.js`): shared `{ busy, seq, scope, data }`. The last load is drawn into every copy, and
  the scope pick stays session-wide as before, so a tap redraws every copy. Each copy has its own view: page handle (its
  Upgrade (N) button), list, search text, note, placeholder and segments. A second copy draws the last load straight away,
  then the load brings it up to date. Removed `redrawCopy` and its `onPageShow`.
- **Installed** (`screens/installed.js`): the module `state` (dpkg list) and `appView` (apps list) are gone. Each apps
  or dpkg page (the root and the pushed #installed/apps and #installed/dpkg pages) gets its own view. `nav()` makes the view
  (so its Manage/Edit/mode/Wish List buttons act on that page), and `render()`, which app.js drawPage calls right
  after for the same page, adopts it (`takeView`). Loads (catalog change, onAppsChange, Show Expiry Dates) go to every
  live view. Manage is per view; the toolbar is still one for the app, owned by the view that turned Manage on
  (`manageBar.owner`). Turning Manage on in one copy ends it in the other. Manage ends on any hash change away from the
  page it was turned on over (`view.hash`), which replaces B172's "end Manage when leaving a copy". Removed
  `redrawCopy`, `COPY_FIELDS`, `copies`, `leaveCopy`, `rootView`, the `onPageShow` hook, the B43 resets for apps/dpkg
  (a new page has a new view, so it starts on the defaults; the Wish List reset stays), and `wishBar` (each view keeps its own
  Wish List button).
  - To keep the diff small, the apps-list functions take the page's view as a parameter still named `appView`
    (`loadApps(appView)`, `drawAppList(appView)`, …), and the dpkg ones as `state` (`draw(state)`, `drawList(state)`).
  - Exported helpers that tests call without a view (`setManaging`, `togglePick`, `selectButton`, `pickMode`,
    `runManage`, `appListOf`, `appListElement`, `addTweakPill`, `refreshAppCount`) default to the view `nav()` made
    last (`latest`), which is what `pageStates()` returns. New export `liveViews()`.
- The Wish List page (`wishView`) stays module-level: it isn't a root, and the brief named only roots.

## Tests

- New `screens/rootcopies.test.js`: `pageViews` unit test, and **Sources' root mounted twice** (a test DOM with
  selectors, insertBefore and innerHTML; the website backend over `fakeIndexedDB`, with fetch refused). Both copies list
  the sources. Typing in one copy's search empties that copy only. A source removed and `manage.sourcesChanged()` → both
  copies reload from one load, and the searching copy keeps its search.
- `screens/installed-pagestate.test.js` rewritten for per-page views (built through `nav()` as app.js does). It keeps B43's
  checks (a pushed page opens on its defaults; Back and tab switches keep it) and adds a two-copies-of-the-root case.
- Source greps updated: `nav/navbuttons.test.js` (`view.page?.rightButton()`), `nav/pullrefresh.test.js`
  (`view.box` / `view.results`), `push-kind.test.js` (the three screens export no `redrawCopy`).
- `node --test web/app`: all pass.
- `tools/smoke/smoke.mjs` and `--site`: passed.
- A browser check in the scratchpad (a copy of smoke.mjs; not committed). It opens each of #/sources, #/installed and
  #/changes, then the same root pushed on Home (#/home/~tab), types into the Home copy's search, switches to the tab,
  then comes back to Home with the tab bar. Jailbreak and site: both copies draw, the tab's copy keeps its own
  (empty) search and row count, and Home's copy keeps "zzqq". No page errors. Run against HEAD before this change (`git archive`), the same check fails on
  Sources: the one shared search bar moved into Home's copy, and the tab's list went from 11 rows to 0. So B172's repair
  didn't cover the search box, and this change fixes that.

## Tried and dropped

- First version of Installed's hand-off from `nav()` to `render()` copied fields between objects and pointed the old
  one at the new (`into`). Replaced with `pageViews.adopt(body, view)`: render takes over the exact object nav() made.
- The first test DOM had no `innerHTML`, which `pullToRefresh` uses. Added a small tag parser to the test DOM.
- I made the first sources.js edit with a heredoc'd Python replace script, against the session rules. Every replacement
  was asserted unique, and the result is checked by the tests above. Every later edit went through the edit tool.

## Not verified

- **Installed's Manage across two copies in a browser**: the toolbar's owner, ending Manage in the other copy, and
  ending it on a hash change. The fake bridge and an empty site have no apps, so Manage never shows. It is covered only by
  reading the code and by `installed-manage.test.js`, which passes; that test runs without a document.
- **Changes with real data in two copies**: the fake bridge has no catalog changes, so both copies showed the
  "No changes" note (0 rows). The browser check confirmed both drew and kept their own search, not that a list
  updates in both. The node two-copy test is for Sources only: Changes and Installed load through the catalog worker,
  which node tests don't have.
- No phone test (iPhone 7 / sideload). The task didn't call for one, and it's a refactor of page state.
- About 82 isConnected checks across the app: only the ones in these three screens that worked around module state were
  removed (Sources' two). `rootShown` (is the managing page on screen) and the toolbar's own attach check stay, since
  they are real questions, not repairs. Checks in other files are out of this task's file list.
