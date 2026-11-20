# F297 Sources: All Apps row

## What
- `web/app/core/allapps.js` (new, pure): `ALL_APPS` (`"*apps"`, the route key), `allAppsRows` (the catalog's
  merged `*` rows → AltStore apps only, one per bundle ID (`<bundle>~<n>` folded), newest version, name order kept),
  `topRowsOf` (which combined rows top the list).
- `screens/sources.js`: the top group now holds All Sources and/or All Apps (both with the folder look,
  `.all-sources-row`), then Recommended. Device type `none` (Not Jailbroken / the sideload build, where only AltStore
  sources show): All Apps replaces All Sources. Otherwise All Sources stays and All Apps joins it once any AltStore
  source is listed. Both hide while searching.
- `screens/browse.js` (three small hooks, beyond the task's file list because the routing lives there):
  `pageOf` maps `[ALL_APPS]` to page `"apps"` (title "All Apps", `renderList` over `allAppsRows`) and
  `[ALL_APPS, "package:<id>"]` to key `*`, so an app opens from the merged catalog: newest version, rendered by its
  own source (`pkg.key`), with the "Source" link/menu item pointing at that source.

## Decisions
- Route as a single path segment, not `["*", "section:…"]`: the nav stack is built from path prefixes
  (router.js), so a two-segment route would have put All Sources' Sections page behind All Apps' back button.
- `"*apps"` can't clash with a source key (keys are URLs or `alt:<url>`).
- No count badge on the row (All Sources has none either; a count would need a catalog round trip on every draw).
- An APT package whose id equals an app's bundle ID would win the catalog's `*` merge if its version compares
  higher and that app would drop out of All Apps; judged too unlikely to special-case.

## Tests
`web/app/core/allapps.test.js`: dedupe/newest, top-row choice per mode and searching, the route parse.

## Not verified
- Not looked at in a browser or on a phone (no UI run in this session): row look, the back button from All Apps,
  and an app page opened from it are checked only through the route parse and code reading.
