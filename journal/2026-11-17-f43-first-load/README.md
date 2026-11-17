# F43: never-loaded sources load on the first visit to Sources

## What I did
- `core/altstore.js` `neverLoaded(source)`: no `updated` and no `error` (a `seedRecord`, F28). Any refresh, even a
  failed one, sets `updated`, so a source is first-loaded at most once ever, not on every visit.
- `core/sources.js` `firstLoadFilter(type)` and `loadNeverLoaded(backend, list, type, { tried, begin })`: picks the
  never-loaded AltStore sources the device type shows (F41 `sourceFilter`), calls `refreshSources` once with a filter
  keeping only those keys, and wraps it in `begin()` (the HUD). `tried` (a Set the screen keeps) stops a source whose
  refresh throws from being asked again on every visit in the session.
- `screens/sources.js`: after the list loads, `firstLoad(ctx)` runs it under the "Reloading Data" HUD and redraws
  with names, icons and counts. Skipped while a Refresh/Add is running (`state.busy`).
- `core/firstload.test.js`: a never-loaded seeded source triggers one refresh (of it alone, HUD shown and hidden);
  loaded, failed and APT sources trigger none; the HUD hides when the refresh throws.

## Decisions
- **AltStore sources only, not APT defaults.** The brief says "any source that has never loaded"; APT defaults
  (DEFAULT_SOURCES) have no `updated` either. I left them to Refresh: their rows already show a name and
  CydiaIcon.png (only the count is missing), and an automatic APT refresh means Packages through the proxy on the
  site, and `apt-get update` in the app, where it would race Refresh on Launch for apt's lock. Since the filter keeps
  no APT key, `withAltSources` never asks the APT calls at all (F41 behaviour).
- **Home's state tile not changed.** `web/app/screens/home.js` is not in the task's files, and the tile only reads
  `error` counts, which never-loaded sources don't change. Home's Sources tile leads to the Sources tab, which
  now does the first load. If Home should trigger it too, it is one call to `loadNeverLoaded` in `refreshState`.

## Not verified
- The HUD and redraw in a real browser or on the phone: no browser run in this session (unattended); the screen
  change is syntax-checked (`node --check`) and the logic it calls is unit-tested.
