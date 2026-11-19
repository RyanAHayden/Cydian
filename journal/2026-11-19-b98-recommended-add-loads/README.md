# B98: adding a recommended source loads it and Search redraws

## What was wrong

The brief assumed `addRecommended` only added the source. Since B75 it already starts the load: `changed(ctx)` →
screens/sources.js's `onSourcesChanged` listener → `loadNew` (reload bar). I kept that path and didn't use
changes.js `reloadSources`, which is the full Refresh (HUD, every source), more than one new source needs. Search
still went stale, for two reasons:

1. Search didn't hear about the add, so its **Recommended Sources** group kept listing the source just added.
2. When the new source landed, Search's re-run (`run({ again: true })`) re-ran only the local query and never
   asked the Recommended group again. And it often didn't run at all. Add Source opens the source's page, whose
   `catalog.ensure()` reads the new source into the catalog first (about 1 s, seen in Chromium). That path never
   fires sources.js `onLanded`, so Search kept showing "No Results" even though `catalog.search` already found the app.

## What changed

- `manage.js`: `onSourcesChanged` returns an unsubscribe. `addRecommended(row, ctx, { backend, alert })` takes
  injectable deps for the tests.
- `catalog.js`: `catalog.onLoaded(f)` fires after any `ensure()` that loaded new or refreshed sources, whoever asked
  for it. (`onChange` couldn't be used: it fires only for versions never seen before, so a re-added source stays silent.)
- `search.js`: `followNewSources` now also follows `onSourcesChanged` and `catalog.onLoaded`, besides `onLanded`. The
  Search page's re-run asks the Recommended group again too (`recs.search(q, { again: true })`: no 450 ms wait and
  no blank first, so the group is swapped once it has been read).
- `screens/recadd.test.js`: the real wiring (addRecommended → sources.js listener → loadNew → land) with the shared
  backend's source calls swapped for a fake, plus the failed-add case and the subscribe/unsubscribe for adds and loads.

## Checked

- `node --test` on recadd.test.js and newsources.test.js passes. Without the `changed` subscription, the first test fails.
- Site in headless Chromium (worker/node.mjs on 127.0.0.1, CDP over Node's WebSocket): searched "livecontainer",
  saw it under Recommended Sources, tapped it, Add Source, waited on the source page, went Back: LiveContainer 3.8.0
  is a normal result and the Recommended group is gone. Before the `onLoaded` part (StikDebug and Manic EMU runs), the
  group dropped the source, but the app didn't show until the query was typed again.

## Found on the way

- main's `web/app/app.js` declares `refreshOnLaunch` twice (an import from F250 and a local const), so the site and
  app stop with a SyntaxError on "Loading". Filed as **B100** (critical). For the Chromium check I served a scratch
  copy of web/app with that const renamed. The worktree's app.js is unchanged.

## Not verified

- Manage > Recommended's Add / Add All, then Search, in a browser: same `addRecommended`/`changed` path, covered by
  the unit test only (time).
- The jailbreak app (WKWebView) and the iPhone 7: the task didn't ask for the phone. The code is shared web code.
- The site check ran with B100's fix applied locally, because main as it stands doesn't load at all.
