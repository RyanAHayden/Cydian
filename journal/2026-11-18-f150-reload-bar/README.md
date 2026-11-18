# F150: Cydia-style drop-down reload bar

## What I did
- `web/app/core/reloadsteps.js` (new, pure): the bar's words. "Updating Sources" while apt-get update runs (jailbreak
  app only: nowhere else is there such a step), then "Downloading <name>" for the first source still waiting
  ("Downloading Packages" when it has no name or none are left), then "Loading Data", then "Building Searcher Cache".
- `web/app/nav/reloadbar.js` (new): `showReloadBar(text, { onCancel })` drops a 44 pt dark translucent strip from the
  top like the banner (kit's semi-transparent black bar at .8), white 12-spoke spinner, bold white status line, blue
  `bar-button done` Cancel. No scrim; `html.has-reload` moves `#navbar` and `#screens` down 44 pt (ios6.css, appended),
  as the banner does. Only transform animates (WAAPI slide in/out, spinner rotate). One bar at a time.
- `web/app/screens/sources.js`: `startRun(ctx, keys)` puts a refresh under the bar: loading marks as before, the text
  following each source's answer, `until(promise)` resolving true if Cancel came first, an AbortSignal for the backend,
  and `data()` for the last two steps (`ctx.loadData` = `catalog.ensure()`, `ctx.buildCache` = `catalog.sections()`,
  which builds the merged All Sources index Search reads). Used by Refresh (was a blocking HUD), the first load of
  never-loaded sources (was a HUD too) and `refreshInBackground` (launch refresh and Home's Reload, had no HUD). The
  1 s HUD linger went with the HUD.
- Cancel: hides the bar, clears the rows' and badge's spinners, aborts the signal, and the waiting refresh returns at
  once; answers still in flight are ignored. `core/sources.js` refreshSources starts no further source once the signal
  is aborted; `backend-native.js` reads nothing back after apt-get update when aborted (the running apt-get update
  itself is not killed: no helper verb for that). Home's Reload stops too (`refreshInBackground` returns "cancelled").
- `app.js` ctx: `reloadBar`, `loadData`, `buildCache`.
- Tests: `web/app/nav/reloadbar.test.js` (step text sequence with and without apt, bar DOM and animations, Cancel,
  no full-screen layer / pointer-events trick and the push-down rule, Sources' run text to the end, Cancel mid-run,
  ctx without a bar) and one in `core/sources.test.js` (aborted signal fetches nothing).
- Rendered the bar over a Sources nav bar at 3x in headless Chromium: `bar-3x.png`.

## Decisions (unattended)
- "pull" in the brief: there is no pull-to-refresh in the app today, so there was nothing to hook. Any future one
  that calls Sources' refresh gets the bar for free.
- "Building Searcher Cache" is honest work: asking the catalog worker for All Sources' sections builds the merged,
  sorted index Search uses, so the first search after a refresh doesn't pay for it.
- The bar covers the status-bar area too (the banner's way, which the user pointed at) rather than sliding out from
  beneath a separate status-bar strip.
- Under a notification banner the bar sits below it and both push the page.

## Tried and failed
- First test for "no scrim" grepped the module source and matched its own comment; it now ignores comments.

## Not verified
- On a phone (iPhone 7 app, Safari site): the task didn't ask to drive a device; only checked by node tests and a
  headless Chromium render. Scrolling and tapping the page while the bar shows on real touch is untested.
- 120 Hz smoothness of the slide on device: not measured (no device run).
- Cancelling apt-get update itself in the jailbreak app: not done (it runs to its end in the background); only
  reading the lists back is skipped.
