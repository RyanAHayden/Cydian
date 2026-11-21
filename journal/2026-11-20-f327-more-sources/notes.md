# F327: More Sources

Concept: https://claude.ai/artifact/AC5Fa8J4xqSqh66wCddGPV (user-approved 2026-11-20).

## What was built

- **screens/moresources.js** (new; tests: screens/moresources.test.js)
  - `#/sources/more`: More Sources. Top group: Find Tweak Sources (Cydia's Tweaks section icon at 40pt with a green
    plus badge; opens F305's `#/sources/manage/find`) and Find App Sources (Packaging section icon; opens
    `#/sources/more/apps`). Then the Recommended header with Add All on the right, a `.bar-button` (nav/ui.js
    `barButton`), no longer in the nav bar. Then the sub-groups Tweak Sources (jailbroken only, with the Jailbreak
    pick as its last row), From the Developer, Modded Apps. Each row has its source icon, name, two lines of why (the
    name it started with dropped, `shortWhy`) and ADD / ADDED in the App Store price button (`.price-btn rec-add`).
    Footer: "Tap a source to see what's in it before adding."
  - `#/sources/more/apps`: Find App Sources: the recommended app sources not added yet, in the same groups and rows.
  - The old `#/sources/manage/recommended` route opens the same page. Its previews (`…/recommended/<key>`) are still
    manage.js's.
- **core/recommended.js**: every AltStore entry has `tag: "dev" | "modded"` (modded: YouMod, Unbound, RyukGram).
  New `REC_GROUPS`, `recGroupOf`, `recommendedGroups`, `shortWhy`.
- **screens/manage.js**: the Recommended page code moved out (the page, Add All, the GET pill, the Jailbreak row).
  `recRows`, `loadPreview` and `recHref` are now exported for moresources.js. Manage's Recommended + Find More
  Sources group is now one More Sources row with the plus tile and the not-added badge.
- **screens/sources.js**: `more.isMore` routes first. Under All Sources, the first-run "Recommended for …" row is
  replaced by a More Sources row that always shows (`moreRow`: rowicons `moreSources`, badge = recommended not added),
  except while searching. The Find More row is gone from the list. Groups are named by what they hold
  (`sourceGroups`): Tweak Sources (APT) and App Sources (AltStore). Jailbroken: Tweak Sources first. The sideload
  app: App Sources, then its Tweak Sources as before. While searching, each header counts ("Tweak Sources: 1 of 2").
- **screens/home.js**: Recommended Sources is now More Sources with the same plus tile, href `#/sources/more`
  (router mountLink keeps it on Home's stack).
- **icons/rowicons.js**: a `plus` glyph and the `moreSources` tile (white plus on the blue tile, no badge). This file
  wasn't on the task's line, but the brief asks for this tile.
- **sources.css**: the Find rows, the green plus badge, the Recommended header, smaller uppercase sub-group headers,
  the rows, and ADD / ADDED. Light and dark look-only rules. The price button tokens are repeated here the way
  tweaks.css does it, because myipas.css only loads with My IPAs. The button's position uses `.rec-more-row .rec-add`
  so that a later-loaded `.price-btn { position: relative }` can't override it.

## Decisions

- **Find Tweak Sources follows `findMoreOn()`** (jailbroken, or the sideload app), not literally "hidden when Not
  Jailbroken". The sideload app keeps Tweak Sources (F302), and F305 built Find More for it. Hiding the row there
  would remove the only way in, now that the Sources tab's Find More row is gone. It is hidden on the website set to
  Not Jailbroken. The Recommended Tweak Sources sub-group is jailbroken only, as the brief says.
- **Find App Sources = the recommended app sources not added yet.** No other app-source directory exists in the repo
  (core/safe-sources.js notes that none is maintained publicly). When all are added, it says so.
- **Tags**: SideStore Team Picks, Flycast (a port's maintainer) and PokeMMO count as "dev". None of them modifies a
  store app; "modded" is only for a store app with a tweak built in.
- **The Jailbreak pick stays** as the last row of the Recommended Tweak Sources group. The concept doesn't show it,
  but without it the filter by jailbreak (F19) couldn't be changed.
- **Manage** keeps one row (More Sources) instead of Recommended + Find More, since both now live on that page.
- **Add All** is the nav bar's `.bar-button` at its full 29pt height ("drawn exactly as"), so the header is a little
  taller than the concept's 24pt drawing.
- **guides.js's link** (`more: Recommended Sources → #/sources/manage/recommended`) was left alone: it isn't on this
  task's line and the route still works.

## Checks

- `node --test web/app`: 2661 pass, 0 fail (before the review fixes). screens/moresources.test.js covers the routes,
  rows, groups, Home row, tags, piracy check and badge count. The Manage, Find More wiring and Home lock tests were
  updated to the new rows.
- 3x renders (capture.mjs from F316, 402x874 @3, web/app served on 127.0.0.1:8791) in `shots/`. Jailbroken = the
  website with Settings > Device rootless; Lite = `--mode sideload` (the fake shell). Kept: jailbroken Sources,
  Home, More Sources, Find App Sources and More Sources' bottom in light and dark (some of each); Lite Sources, Home,
  More Sources and Find App Sources. The jailbroken site's sources show Not Responding / HTTP 404 because a static
  server has no `/api/fetch` proxy. Only the rows' look matters here.

## What failed on the way

- Drawing the Sources root in the unit-test fake DOM failed (pullToRefresh needs markup the plain fake DOM can't
  build; rootcopies.test.js builds its own). The test checks the wiring by reading the source, plus `moreRow` and
  `sourceGroups`. The drawn tab is in the renders.

## Not verified

- Not run on a phone (iPhone 7 jailbreak build, iPhone 15 Lite). The task asked for renders, and the screens are the
  shared web/app.
- ADD and Add All against live sources, and the source icons loading in the renders (the static server can't proxy
  fetches). The add path is manage.js `addRecommended`, unchanged and covered by recadd.test.js.
- iOS 7 era and the other palettes: only light Classic and dark Gunmetal (the defaults) were rendered.
