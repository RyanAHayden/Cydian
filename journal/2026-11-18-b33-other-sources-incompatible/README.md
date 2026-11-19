# B33: Other Sources follows Show Incompatible

## What changed

- `web/app/screens/extras.js` `discoveryGroup(ctx, opts)`: rows with `archOk` false are filtered out while
  `opts.hideIncompatible()` is true (Show Incompatible off). The filter runs before the 25-row cap, so hidden rows
  don't eat slots. When every row is filtered out the existing `if (!rows.length) return;` leaves the box empty: no
  header, no footer. New option seams for tests: `search`, `sources`, `arch`, `wait` (defaults are the old
  behaviour). The default `hideIncompatible` reads `settings.get("worksOnMyPhone") === true`, which is what
  device.js `compatFilterOn()` does. I didn't import device.js into extras.js because device.js pulls in
  catalog.js (the parse worker), and extras.js deliberately loads catalog.js late.
- `web/app/screens/search.js` passes `{ hideIncompatible: compatFilterOn }`. Redrawing on the switch was already
  wired: `settings.onChange` reruns `run()` on `worksOnMyPhone`, and `run()` calls `others.search(q)`. That
  fetches Canister again after the 450 ms pause. I didn't add a cache: it isn't needed for correctness, and a cache
  would hold on to a stale "added" state.
- Tests: `extras.test.js` (3 B33 tests over a fake DOM: filter on leaves out the rootful row, filter off keeps it
  with "Other device", all hidden draws nothing) and `search.test.js` (a source check of the wiring).

## Tried and failed

- The worktree's `ref` symlink pointed at `/home/ryha/repos/Cydian/...` (the old repo name), which no longer
  exists. I relinked it to `/home/ryha/repos/iFizBox/ref`. `ref` is gitignored.

## Device check (iPhone 7, 2026-11-18 15:25)

I built this branch's .deb (0.9.4-1208) and installed it with apt. I waited for B32 to release the UI lock first.
Then I searched "you" from the Recent row and scrolled to the bottom. Screenshots are in `ref/7/screens/`:
- `b33-other-sources-incompat-off.png`: Show Incompatible OFF (the default). Other Sources has three Tinyapps
  rows, none marked "Other device".
- `b33-other-sources-incompat-on.png`: after I switched it ON in the Filter sheet and tapped Done, Other Sources
  redrew with its "Other device" rows back (ZodTTD & MacCiti archive ringtones and so on).
I switched it back OFF afterwards, so the phone is left as I found it, with this branch's build installed.

## Reopened session (2026-11-18)

The run reopened B33 unticked, but commit 6b4f968 (the code, the tests and this journal) was already on main. I
checked it again: the extras and search tests pass (16/16), the B33 filter code is in extras.js and search.js, and
both device screenshots show what the brief asks for. I made no code change and only ran the gate to tick the task.

## Not verified

- I didn't see the "every row hidden, no group" case on the device: "you" always has some compatible rows. The node
  test covers it (`extras.test.js`, third B33 test).
- The site (backend-http) wasn't checked in a browser. It uses the same `discoveryGroup` code path.
