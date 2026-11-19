# B75: Search finds sources just added without a visit to Sources

## What was wrong

Adding a source (Manage > Recommended > Add All, a single Add, Import) only stored its URL. Never-loaded sources
were loaded only on the Sources tab's first visit (`firstLoad`) and quietly by Search's Filter panel, so
`catalog.search` had nothing for them until Sources > Refresh. Also, `onSourcesChanged` called `load()` with no
ctx, so even with the Sources list drawn, a first load after an add ran without the reload bar.

## What changed

- `screens/sources.js`
  - `firstLoad` is now one shared run: it returns its promise (`state.current`); a call while any run holds
    `state.busy` sets `state.again` and gets that promise; `fresh: true` reads the list inside the busy section.
    When a Refresh / background refresh / retry / first load ends (not cancelled), `runAgain` does one more pass
    for what was asked during it. A cancelled run doesn't start another bar.
  - `loadNew(ctx)` (exported): `firstLoad(ctx, { fresh: true })`, under `startRun`'s reload bar (Refresh's words,
    progress, Cancel), rows and badge. `state.tried` is the one tried set for every caller.
  - `onLanded(f)` (exported): called after each `feedCatalog` → `ctx.loadData()` finishes, i.e. once a landed
    source's packages are in the catalog (Refresh, retry and loadNew alike).
  - `onSourcesChanged((ctx) => …)`: Sources list drawn → `load(ctx ?? state.ctx)`; not drawn → `loadNew(ctx)`.
- `screens/manage.js`: `changed(ctx)` from addSource (also Add from clipboard), addPicked (Import), addRecommended
  (also Search's Recommended group) and addAll. Delete/reorder still call `changed()`.
- `screens/search.js`: `followNewSources(ctx, rerun, alive)`: calls `loadNew(ctx)` on opening and again from each
  typed (non-`again`) run; subscribes to `onLanded` and re-runs the current query with `run({ again: true })`
  (keeps the scroll, doesn't re-ask Other Sources/Recommended, doesn't blank the note). No text note: the
  progress is the reload bar, per the user's note on the task. The Filter panel's own `loadNeverLoaded` with its
  private tried set is replaced by `loadNew()`.
- Pre-existing bug found by the new test: `firstLoad`'s `begin` returned nothing, so `loadNeverLoaded`'s
  `finally { end() }` threw after the downloads; `firstLoad` swallowed it, so the list was never re-read and
  redrawn after a first load (the per-row onEach updates still showed). Fixed in both places (begin returns a
  no-op; core guards `end`).

## Test

`web/app/screens/newsources.test.js`: fake backend (one seeded AltStore source), fake catalog via
`ctx.loadData`, fake `ctx.reloadBar`. Opening Search (`followNewSources` with the real `loadNew`/`onLanded`)
asks `refreshSources` for that key, one reload bar with Cancel drops and hides, and the query re-runs and finds
the source's rows once it lands; typing again downloads nothing more.

First run failed with `TypeError: end is not a function` → the pre-existing bug above.

First gate run failed `nav/reloadbar.test.js` "F150: a run drops the bar…": wrapping feedCatalog's loader in an
async function (await loadData, then the listeners) added a microtask, so the coalesced second load landed after
`run.data()`'s cache step. Now the listeners hang off loadData's own promise (`.then(fireLanded)`) and the loader
returns that promise unchanged, which keeps the old order.

## Decisions

- APT sources are still not first-loaded (`firstLoadFilter` is AltStore-only, as F43 chose: apt-get update would
  fight Refresh on Launch for apt's lock). The reported case (youmod on the IPA) is an AltStore source. Adds from
  other screens (extras.js, home.js, importlink.js, account sync) don't pass ctx through `changed`; Search
  catches them on opening anyway (files outside this task's list).

## Not verified

- Not run on a phone or in a browser (no device test asked for; the IPA build/sideload test needs the Tailscale
  page route and a human). The reload bar's look while Search is on screen and the re-run timing on the real
  catalog worker are checked only through the fake ctx in the node test.
- A Cancel on a first-load bar still waits for `refreshSources` to finish before `busy` clears (loadNeverLoaded
  passes no signal); unchanged from before.
