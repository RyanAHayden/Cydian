# F250: website refreshes sources on Browse Anyway and on launch

## What changed
- `web/app/screens/changes.js`: Changes' Refresh body is now the exported `reloadSources({ hud, backend, alert, reload })`
  (refreshSources with this device's sourceFilter, Reloading Data HUD, catalog.reloadInstalled in native, load()).
  The nav button's `refresh(ctx)` calls it with the tab's HUD. One job at a time (`state.busy`, shared with the button).
  The HUD is shown before `busy` is set, so a throwing HUD (no DOM) can't leave the job stuck busy.
- `web/app/websign-gate.js`: `refreshSourcesNow` (dynamic import of changes.js -> reloadSources, keeps the gate module
  light) and `refreshOnLaunch({ mode, storage, win, refresh })`: website only (mode "site", no ifizboxApp /
  ifizboxNative), only when `browsingLocked` is false. `askToBrowse` takes `refresh` (default refreshSourcesNow) and
  starts it, not awaited, on Browse Anyway. All three callers (Home, locked tab, Settings > Website) get it through the default,
  so home.js and website-settings.js need no change.
- `web/app/app.js`: `refreshOnLaunch({ mode: detectMode() })` right after `router.start()`.
- Tests: `web/app/websign-refresh.test.js`.

## Decisions
- Refresh on Browse Anyway isn't awaited: the gate returns "browse" at once and Home redraws through
  `ifizbox:browse-lock` as before. The HUD covers the screen while the refresh runs, the same as Changes' Refresh.
- A launch refresh shows the same Reloading Data HUD. The brief says "the same job", so it doesn't run silently.

## Tried and failed
- nothing

## Not verified
- Not run in a real browser or on an iPhone: the HUD at launch over the first Home draw, and the timing next to
  catalog loading at launch, were not seen. Only the node tests (with fake backend/HUD) and tools/check.sh ran.
