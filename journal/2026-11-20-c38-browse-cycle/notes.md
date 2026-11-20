# C38: break the screens/browse.js -> manage.js -> roulette.js import cycle

The cycle was two loops through browse.js:

- browse.js <-> roulette.js: browse drew Roulette's row (readSpins, currentStreak, rouletteRow); roulette's wheels
  page uses browse's package helpers (wishlist, iconBox, rememberNames, token, storeLabel).
- browse.js <-> manage.js: browse's dependency "Add source" row called manage.js addSource; manage's Packages
  list uses browse's packageList.

What I did:

- New `web/app/screens/roulette-row.js`: the streak store (ROULETTE_KEY, readSpins, saveSpins, recordSpin,
  currentStreak) and Browse's row (ROULETTE_SUBTITLE, rouletteTitle, rouletteRow), moved as is. It imports only
  router.js and core/catalog.js. roulette.js imports what its page uses and re-exports the rest, so
  roulette.test.js and other importers are unchanged. browse.js imports from roulette-row.js, which also means
  Browse no longer pulls the whole wheels page in statically (it is a lazy.js module).
- browse.js reaches addSource through `lazy.js` `load("manage")` on the tap (manage is already a lazy module;
  addSource was async, so the row's onClick just returns the promise one step later).
- import-cycles.test.js: KNOWN is now empty.

Checks: `node --test web/app/import-cycles.test.js` passes; all web/app node tests pass (2532).

**Not verified**

- The "Add source" row on a package's dependency list was not tapped in a browser or on a phone: it now waits for
  manage.js to load (normally already in, as app.js loads every lazy module in the background after the first
  page). Checked by reading only.
