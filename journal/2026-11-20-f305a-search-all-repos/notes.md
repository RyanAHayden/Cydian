# F305a Add Tweaks' Search All Repos + Canister facts on an APT source's page

## What I did

- `web/app/screens/tweaks.js`: the Add Tweaks sheet's last group now lists Browse Tweak Sources, **Search All Repos**
  (detail "Canister", class `tw-search-all`), From Files…. Tapping it calls `findmore.js searchAllRepos({ appName })`
  through `openSearchAllRepos`, loaded with a dynamic import so tweaks.js doesn't pull findmore.js (which imports
  extras.js, which imports tweaks.js) into its load. `openAddTweaks` takes a `searchAll` seam for the tests. The
  group's footer ends with "Search All Repos finds tweaks for <app> in repos you haven't added."
  (`searchAllFooter`). I appended it to the existing footer rather than a second footer: one group, one footer.
- `web/app/screens/browse.js`: an added source's Sections page appends `canisterFactsSlot(source)` after the health
  footer. It asks `findmore.js canisterTrust` (cached a week per repo) and, when Canister lists the repo, fills with a
  Trust group: HTTPS (Yes/No/Unknown, `find-warn` amber when No), Signed Releases, footer "From Canister
  (canister.me), which checks this repo's files." AltStore sources (`alt:` keys), repos Canister doesn't list and
  offline leave the slot empty. The group appears late; nav/slide.js (F299) slides it in automatically.
- Tests: `screens/browse-canister.test.js` (new), one test appended to `screens/tweaks-app.test.js`.

## Decisions

- `ctx` passed to searchAllRepos is null: the Add Tweaks sheet has no screen ctx. offerTweak / sourcesChanged handle
  a null ctx (falls back to the global showHUD; listeners get null).
- The Add Tweaks sheet doesn't redraw when an Add to App made from the Search All Repos sheet adds a tweak to this
  app: searchAllRepos has no close callback and findmore.js is outside this task's files. Reopening Add Tweaks shows it.

## Not verified

- No browser or phone run: the row and the Trust group were checked with the node fake DOM only (no sideload IPA
  build or iPhone in this task). The live Canister answer for an added repo's page wasn't fetched here (unit seams).
- The Add Tweaks sheet's "Added" group doesn't refresh after an add from Search All Repos (see Decisions).
