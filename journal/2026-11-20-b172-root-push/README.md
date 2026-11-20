# B172: the other links to a tab's root slide in

B169 made Home's What's New push Changes on Home's stack (`router.js rootOn`, `#/home/~changes`). These links still
switched tabs with no slide; now each one pushes that tab's root above the page it sits on:

| link | href now |
| --- | --- |
| Home's green tile, Loading Sources / N Sources Failed to Load (and its first paint) | `#/home/~sources` (`home.js SOURCES_HREF`) |
| Find Extensions for Applications | `#/home/~search` (`SEARCH_HREF`) |
| Help's Refresh Sources | `#/home/help/~sources` |
| a guide answer's Next > Refresh Sources / Installed | `#/home/guides/faq/<id>/~sources`, `…/~installed` |

`guides.js`: `LINKS.refresh/installed.href(on)` and `linkRow(id, mode, on)` take the route the row sits on;
`answerView` passes its route. Without `on` they stay plain tab links (guides.test.js's `linkRow("refresh")`).

## Making each root safe to draw twice

The root can now be on screen in two places (its own tab and pushed on Home). Each screen kept module state for it:

- **Sources** (`state.body`, one search bar `state.bar`, `state.box`): `redrawCopy(el)` (an `onPageShow` for the
  root) makes a copy that comes back to the top the one `state.body` points at and calls `draw()`, which moves the
  search bar into it and rebuilds the list. `rowOf` looks inside `state.body`, not the whole document, so a refresh
  paints the copy on screen and not stale rows left in the other.
- **Search**: each render already has its own field and closures; the query and filters are the session's. A
  `copies` WeakMap keeps each root copy's `{ input, bar, drawScope, run, asked }`; `showCopy(el)` on show makes that
  copy `reselect()`'s field and, if the query/filters moved on in the other copy, sets the field and searches again.
  **Bug found in Chromium and fixed:** `run({ again: true })` (a source landing) re-runs every copy still drawn, and
  it wrote its own field back into `state.query`, so the hidden copy put its old text back. Only a run the user
  started sets `state.query` now.
- **Installed** (`appView` for the apps list, `state` for dpkg's): each copy keeps its own User/Recent (Expert),
  type and search text. An `onPageOpen` registered *before* B43's resets stores the fields of the copy on screen
  under its body (a pushed copy still opens on its defaults, as B43 wants, and the tab's root keeps its choice);
  `redrawCopy` on show stores the other copy's, restores its own and redraws. Manage is ended first (its toolbar
  belongs to the copy that turned it on), and the Manage button changes the button that was tapped
  (`manageBar.right = e.currentTarget`), not the last one built.

Tests: `push-kind.test.js` (push + Back pop for every link, also right after a visit to that tab; guides' hrefs;
the redraw guards). `home.test.js` and `guides.test.js` now expect the pushed hrefs.

## Checked in Chromium

B169's `journal/2026-11-20-b169-push-slide/serve.mjs` + `probe.mjs` (headless, iPhone UA, real mouse events), the
site with `ifizbox.firstVisit=later`, the app with a fake bridge
(`globalThis.ifizboxNative={mode:'jailbreak',call:()=>Promise.resolve(null),on:()=>{}}`; `call` never resolving
keeps the tile on Loading Sources):

| case | site | app (fake bridge) |
| --- | --- | --- |
| Find Extensions | slides 359–376 ms, Back slides | slides 377 ms, Back slides |
| Help > Refresh Sources | slides 379 ms, Back slides | slides 376 ms, Back slides |
| Green tile, Loading Sources | - | slides 380 ms, Back slides |
| FAQ answer > Installed | slides 363 ms (expired), Back slides | slides 380 ms (tweak), Back slides; Installed tab drawn after |
| Search tab after typing in the pushed copy | tab copy shows the new query; Search tab tap focuses the tab's field; clearing it in the pushed copy clears the tab's | - |
| Sources tab after the pushed copy | the tab's copy gets the search box back, 10 rows, each time it is shown | - |
| Installed tab on Recent, then FAQ > Installed | pushed copy opens on User, the tab's copy still Recent and redrawn | - |

## Follow-up

B176: a pushed Sources (and Changes, since B169) has Back where its Refresh button was; only pull-to-refresh is
left, so Help's "Refresh Sources" opens a page with no Refresh button.

## Not verified

- **On a phone (iPhone 7 app, iPhone Safari).** Not run: needs a fresh .deb of this branch and the ui-7 lock, and other
  slots overwrite the 7's .deb. The routing and the slide are the same code Chromium ran.
- **Real native backend.** The app runs used a fake bridge answering null (or never). Sources with real rows during
  a live refresh in the pushed copy, the jailbreak dpkg list's Expert mode kept per copy, and the sideload Installed
  list in Manage while a second copy opens were not drawn with real data. The site has no installed apps, so the
  Recent list itself (not just the control) was not compared.
- **Installed's Edit (jailbreak Apps page) across copies.** Only the root (dpkg in the jailbreak app) can be pushed,
  and Edit lives on the `apps` page, so not reachable; not tried.
