# B141: imported sources load, Search retries failed ones

Lite on an iPhone 15 Pro, fresh install: the first launch imported the website's sources (transfer.link), then
Search for "unbound" found nothing although the Unbound source is a default.

## What was wrong

1. `screens/importlink.js reviewAndImport` added the sources and told nobody. The launch refresh had already run,
   so nothing loaded them. Sources the import adds as AltStore links are saved by `withAltSources.addSource` as
   already read (`ipaRecord`: `updated` and `count` are set, so they aren't "never loaded"). Search's catalog only
   runs `ensure()` once (`ready()`), so their apps never got into the catalog until a Refresh.
2. A source whose first fetch failed gets `updated` + `error`, so `neverLoaded` is false. Each key is tried once
   per session, so Search never loaded it again.
3. (Checked) An IPA record added through `altstore addSource` gets into the catalog only once something calls
   `catalog.ensure` (`ctx.loadData`). Add Source used to get that from the source page it opens. The import got
   nothing (see 1).

## What changed

- `screens/manage.js`: `sourcesChanged(ctx)` exported (the existing `changed`), for adds made outside Manage.
- `screens/importlink.js`: after at least one source is added, calls `changed()` (by default a dynamic import of
  manage.js's `sourcesChanged`, because settings.js -> importlink -> manage -> settings would be a start-up
  cycle).
- `screens/sources.js`:
  - The onSourcesChanged listener also calls `feedCatalog`, so records that are already read reach the catalog.
  - `useContext(ctx)` keeps the app's ctx for loads started where no screen passes one (app.js calls it at
    start). Without it the import's load would have had no reload bar and no `loadData`.
  - `loadNew(ctx, { retry })` passes a per-visit retry Set down. A busy run keeps it in `state.againRetry` for
    `runAgain`.
  - `isLoading()` and `onSettled(f)`: `settle()` fires after each run ends (first load, Refresh, launch refresh,
    row retry) as long as no other run has started.
- `core/sources.js`: `retryFilter(type)` covers AltStore sources that are never loaded, errored, or have count
  null/0, and leaves out `unsupported` ones. `loadNeverLoaded(..., { retry })` loads those that aren't in `retry`
  yet and adds them to it.
- `screens/search.js`: `followNewSources` keeps a `retry` Set per visit, passes it to `load`, and also listens to
  `onSettled`. The empty note comes from `emptyNote(count, isLoading())`: "Sources are still loading…" while a
  run is going, otherwise "No Results".
- `app.js`: `SCREENS.sources.useContext?.(ctx)`.

Decision: "no apps" (count 0) counts for the retry, as the brief asks. A source that really is empty therefore
gets one reload-bar fetch per Search visit. It's cheap, and the brief asked for it.

## Tests

`web/app/screens/importload.test.js`: the import loads a never-read source under the reload bar and gets an
already-read one into the catalog. Search retries a source whose first fetch failed, shows the loading note while
the retry runs, re-runs and finds the app, and doesn't fetch it a third time in the same visit. Also covers
`emptyNote` / `retryFilter`.

What failed along the way: the fake addSource got `altstore://source?url=…` (that's what the import hands over),
not the bare URL. Separately, sources.js's coalesced `feedCatalog` keeps the first ctx it saw, so the test file now
shares one ctx between worlds, the same as the app.

## Not verified

- On a phone (Lite on an iPhone 15 Pro, a fresh install with transfer.link): no device run in this session. The
  flow is covered only by the node tests with a fake backend.
- I didn't check that the new test fails without the fix (it can't be done safely here without stash/reset).
  Reading the code: test 1 needs the import's `changed()`, and test 2's second fetch needs the retry Set.
- The note's wording and how it looks on screen (no DOM run).
