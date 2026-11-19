# F233: async refresh, one row per source

## What changed

- `web/app/core/refreshrows.js` (new, pure): row states (waiting, loading, done, failed), `stripText`
  ("Refreshing 5 of 8…", then "6 refreshed, 2 failed"), `tabBadge` (a spinner while running, then the failure count)
  and `coalesce` (one catalog load at a time, plus one more for calls made meanwhile).
- `web/app/core/aptupdate.js` `liveUpdate(sources, onRow)`: apt-get update's streamed `{ fd, line }` events mapped to
  rows. A Get/Hit/Ign line makes the row spin (once). An Err line plus its indented reason turns it red;
  Translation-* never does. stderr's `E: Failed to fetch` and `E: The repository …` lines turn rows red too. It uses
  the same URI/suite matching as `failureFor`. apt says nothing per source when one is done, so the rows that didn't
  fail land when the lists are read back after apt ends.
- `backend-native.js`: `refreshSources(onEach, { onRow, retry })`. With `onRow` it streams the helper (`update(feed)`).
  With `retry` and a filter that keeps one source, it calls the new `updateSource(source)`: `ifizbox-helper
  update-source <uri> <suite> [components]`, falling back to the whole `update` on exit 64.
- `core/sources.js` and `core/altstore.js` pools call `onRow(key, "loading")` as each source starts. The AltStore
  wrapper now passes `onRow`, `signal` and `retry` on to the APT calls (before this it dropped `signal`), and its pool
  stops starting sources once `signal` aborts. `loadNeverLoaded` passes `onRow` on.
- `screens/sources.js`: rows painted from the run's state (`paintRow`): grey Waiting, spinner, count, or a red "!"
  badge with the reason in red in place of the subtitle. A strip sits under the nav bar (sticky; the category bar
  sticks under it). The Sources badge spins, then counts failures. A summary with no failures hides after 4 s; one
  with failures stays. A tap on a failed row runs `retrySource` (that source only). Holding a failed row shows Open
  (to its old lists) beside Copy URL. Each landed record calls `ctx.loadData` (catalog.ensure) through `coalesce`,
  so its packages reach Changes and Search before the rest. State lives in the module, so leaving the tab mid-run
  is fine, and coming back repaints.
- `packages.css`: the strip, Waiting, and the red failed badge (the tab badge's gloss), with no chevron on waiting
  or failed rows.
- The existing reload bar (bottom, fixed words, Cancel) stays as it was. Cancel clears the rows, strip and badge.

## Decisions

- **Strip vs reload bar.** F179 keeps counts out of the reload bar, so the counting strip is a separate element on
  the Sources page, as the brief asks ("under the nav bar").
- **Native retry without a new helper.** The helper verb is C work (temp sources file, fork/wait,
  `APT::Get::List-Cleanup=0` so other lists survive). I split it off as **F233a**. Until it lands, the JS asks for
  `update-source` and falls back to the full update, so the retry works now, just slower.
- **Updated test.** `nav/reloadbar.test.js` F150 run test: the steps now include the per-source catalog loads. It
  asserts the last two are load and cache, plus at least one early load.

## Checks

- `node --test web/app`: 1447 pass, including the new `core/refreshrows.test.js`, `core/aptupdate-live.test.js` (the
  iPhone 7's real 525 fixture fed line by line, plus synthetic Err/E: cases) and `backend-native-live.test.js`
  (the fake helper's streamed Err turns HAVOC red before any record lands; retry asks update-source, then falls back).
- Chromium, as the jailbreak app with a fake bridge (`capture.mjs` here, adapted from T12's). It used a synthetic
  apt state (`mkphone.mjs`: 6 flat sources) and a fake helper streaming Hit/Err lines 700 ms apart.
  `mid-run.png` shows Waiting, spinners, dead.test already red, and "Refreshing 2 of 7…". `after.png` shows the
  counts, two red rows with apt's reasons, and badge 2. The strip read "5 refreshed, 2 failed". A tap on a red row
  retried only it (update-source, then a list read that failed again because the harness has no lists for it), and
  the route stayed `#/sources`.

## Not verified

- **iPhone 7.** A dead source and a 404 source going red on the real device was not checked. It needs a .deb build
  and install, plus temporary test sources on the phone, which wouldn't fit in this session. Filed as **R24**, after
  F233a.
- **The one-source apt-get update.** Not run anywhere: the helper verb doesn't exist yet (F233a). Only the fallback
  path is tested (fake helper, exit 64).
- **Real apt's timing.** Whether real apt streams Err reason lines right after their Err line under load is not
  checked. If another line comes first, the row still goes red, with no reason in the text.
- **Website path in a browser.** The core/sources.js pool's onRow is covered only by code review and the shared
  screen code. No screenshot was taken through the worker proxy.
- **The mockup.** The artifact at claude.ai couldn't be opened from here, so the look follows the brief's words and
  iOS 6 parts already in the app.
