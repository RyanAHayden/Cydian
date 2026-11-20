# B198 — startup.test.js: let Chromium pick its DevTools port

## What I did
- `web/app/startup.test.js` launched Chromium with a random `--remote-debugging-port` in 9400-9899, so two
  Chromiums at once could land on the same port and the test could attach to the other one's browser.
- It now passes `--remote-debugging-port=0`; Chromium binds a free port and writes it as the first line of
  `<user-data-dir>/DevToolsActivePort`. The wait loop reads that file (each run has its own mkdtemp profile), then
  polls `/json/list` on that port as before, inside the same 75 × 200 ms budget.

## Checks
- `node --test web/app/startup.test.js`: pass (3.5 s, not skipped).
- Two copies run at the same time: both pass.

## Not verified
- The IPA/deb build's bundled-web run (`IFIZBOX_WEB_DIR=...`) was not run by hand; it uses the same `boot()`, and
  the gate (`tools/check.sh`, run by `run done`) exercises the build.
