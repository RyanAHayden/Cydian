# N4: the install queue (Confirm sheet, console, logs)

Cydia's queue in the shared UI, with native plumbing through the root helper. No jailbroken test phone (user
2026-11-17): everything below ran against N3's fake helper (`native/fake/cydian-helper`) and the real helper's
checks on Linux.

## What was done

- **Helper verbs** (`native/helper/policy.c`, `main.c`, README table): `simulate <item>...` is
  `apt-get -s --reinstall --allow-downgrades install <items>`; `apply <item>...` is the same with `-y`, confdef/confold,
  `APT::Keep-Fds::=3` and `APT::Status-Fd=3`, and `CYDIA=3 1` in the environment (Cydia's finish protocol:
  maintainer scripts write `finish:restart` to that fd); `respring` runs `sbreload`, else `killall -9 backboardd`.
  Items: `name` (newest), `name=version` (Downgrade, Reinstall, Version History), `-name` (remove), translated to
  apt's `name`, `name=version`, `name-` in **one** `apt-get install`, so a mixed queue is one run, as in Cydia.
  Checks: names as before (an install's may not end in `-`/`+`), versions `[0-9][A-Za-z0-9.+~:-]*` ≤ 255, no package
  twice, installs known to dpkg or apt's lists, removals known to dpkg. Tests in `test_helper.py` (plans, refusals,
  known packages, respring fallback, and the whole chain: `CYDIA` set and fd 3 kept for apply only).
- **Fake helper**: the same three verbs over the fixture. `simulate` prints `Inst`/`Remv`/`Conf` lines (no
  dependency resolution) or, with `FAKE_FAIL=simulate`, apt's unmet-dependency report on `FAKE_MISSING`; `apply`
  streams `Get:`/`Unpacking`/`Setting up`/`Removing` lines and `pmstatus`/`dlstatus` on fd 3, really edits the
  fixture's dpkg status, and writes `finish:$FAKE_FINISH`; `FAKE_SLOW` slows it for walk-throughs.
- **`web/app/core/queue.js`** (pure, `queue.test.js`): the queue (one job per package; modes install / reinstall /
  upgrade / downgrade / remove from the installed version), `queueWords`, `parseSimulation` (Cydia's five lists,
  essential-package warnings and the firmware/gsc/cy+ stand-ins as issues, "Need to get" size), `parseStatusLine`
  (pmstatus, dlstatus, pmerror, pmconffile, dpkg's status:/processing:, finish:), `consoleText` (text after the last
  `\r`), finish levels and labels, `needsRestart` (Cydia: a queued package, old or new version, depends on
  mobilesubstrate; plus ellekit/substitute/libhooker for rootless), and the console log store (newest 20 runs,
  60k characters each, head + tail kept, localStorage with an in-memory fallback when full).
- **`web/app/queue.js`**: the app's one queue and log store. **`backend-native.js`**: `queue(job)`, `simulate(jobs)`,
  `apply(jobs, onEvent)`, `respring()`, jailbreak build only (the sideload build has no helper, so no `queue`, and
  browse.js keeps its no-queue sheet). A helper refusal (64/77/126) throws BackendError `helper` with its words;
  apt saying no resolves `{ ok: false, output }` for the sheet.
- **Catalog ops** (`core/catalog.js`, `catalog.js`): `aptProblems(output)` runs F18's `explainApt` over the same
  dependency index `deps` builds (factored into `currentDepIndex`); `queueInfo(ids)` gives names and the restart flag.
- **`screens/queue.js`** + `queue.css`, wired from `app.js` when the backend has `queue`:
  - Queuing (Install/Upgrade/Reinstall/Remove/Downgrade on the package page, a Version History row, F18's
    "Remove X") opens **Confirm** at once: apt-get -s over the whole queue; Statistics (download size when apt says
    one), Modifications (Cydia's order, names one per line), the queue (tap one to Clear it; the sheet asks apt
    again), Continue Queuing. Cancel clears the queue; Confirm (Done style) only shows when apt agreed.
  - **Cannot Comply** when apt refuses or an essential package would go: each F18 sentence in a pink group with its
    action (Add <source>, Remove <package> through the queue, Open <package>), then apt's raw output, always. A
    helper that can't run says so ("Couldn't Ask apt"), never silently (Zebra #2052).
  - **Console**: black page and bar, "Running" then "Complete", output lines grey, status lines white bold (ids
    replaced by names), errors red, a 158 px progress bar, then the 300 px finish button: Restart SpringBoard (needs
    restart, or a script's finish:restart), Reload, Reboot Device (an alert: the app can't reboot), else Return to
    Cydian; Close in the bar. Lines are batched per animation frame, at most 1500 kept on screen (the log keeps
    all). A failed run adds an exit-code line and F18's sentences in red. After the run: the log is saved, the
    installed list reloads, and the queue is emptied when apt succeeded (kept when it failed, so Confirm can show
    what is left).
  - **Marks**: every package list (all go through browse.js `packageList`) shows "Queued for <mode>" in place of the
    description, bold in the detail blue (red for Remove), updated live on every queue change (Zebra #1992, #1892).
    The package page gets Cydia's "Package Queue" group and Modify's first action becomes Clear. The Installed tab's
    badge reads **Q'd** and its nav bar gets a Queue button (Done style) that reopens Confirm.
  - **Settings > Console Logs** (jailbreak build, or whenever logs exist): the runs, newest first, each opening its
    full console text; Clear Logs.
- **browse.js** (F29's call sites): the queue gets `installed` and `name` with each job (so the mode is right at
  once); Modify now offers Upgrade when a source has a newer version, and Reinstall only when a source still offers
  the installed version (Cydia: "only if the package has a source"; apt can't reinstall what it can't download).

## Tried, failed, changed

- First walk-through showed one version only: the extra 0.9 stanza was appended without a blank line and merged
  into the previous stanza, then Chromium's IndexedDB kept the first run's Packages, then the fake `apt-get update`
  copied the remote lists over the prefix's. Fixed in the walk-through server (both copies, `\n\n`, fresh profile).
- The Installed tab's Queue button didn't appear: that tab's nav bar is built when first shown. It is now put in
  after every route change as well.
- Reading `globalThis.localStorage` in node prints an ExperimentalWarning; `queue.js` only reads it on a page.
- Kept `--reinstall` on every simulate/apply rather than a separate reinstall item: it only affects named packages
  already at the asked version, which is exactly Reinstall.

## Walk-through

`tools/serve.mjs` (web/app with a `cydianNative` shim whose calls go to `fake-native.mjs` over NDJSON, so helper
lines stream live) + `tools/shots.mjs` (headless Chromium, 390×844, saved at 1.5×): `shots/1…14-{light,dark}.png`:
package page, Modify (Upgrade / Remove / Downgrade), the Downgrade version picker, Confirm, the page with its
Package Queue group, the marked list, Installed with Q'd and Queue, the console mid-run (only the first line
streamed) and complete with Restart SpringBoard (0.9 depends on mobilesubstrate), Console Logs and one log, Cannot
Comply with F18's "Held Tweak needs mobilesubstrate … it is on ElleKit" + Add ElleKit above apt's output. Cancel
emptied the queue. No page errors.

## Follow-ups filed

- F62 Changes tab "Upgrade (N)" through the queue. F63 Configuration Upgrade alert (conffiles always keep the old
  copy now). F64 Cancel during downloads.

## Not verified

- **Nothing ran on a phone** (no jailbroken modern test phone): the real `apt-get -s` / `apply` output, `sbreload`
  and the `killall backboardd` fallback, Swift's `helper.run` streaming a long run, the console on a real WKWebView.
- **apt keeping fd 3 open for maintainer scripts** (`APT::Keep-Fds::=3`, as Cydia does with its own fd): from apt's
  docs and Cydia's source, not seen working. If it doesn't reach scripts, `finish:` lines never come and only the
  mobilesubstrate rule raises Restart SpringBoard.
- `--allow-downgrades` needs apt ≥ 1.1 (Procursus/ElleKit-era rootless apt is 2.x); not checked on a phone.
- apt's exact essential-package warning text (parsed from memory of apt's output) and whether `apt-get -s` prints
  "Need to get" (the Statistics row only shows when it does).
- `uicache` after a run (Cydia runs it): not done; rootless dpkg triggers usually refresh app icons. Not checked.
- The iOS helper and app were built by the gate (`tools/check.sh` ran `make -C native package`: Cydian.deb with the
  new helper, checked by mkdeb.py); built, not run.
- The fake helper doesn't resolve dependencies, so the Confirm sheet with dependencies pulled in (extra Install
  rows) was only tested through `parseSimulation` on hand-written apt output.
- Pixel comparison with Cydia's console/confirm pages: by eye from docs/cydia.md's sizes; no capture of Cydia's
  queue screens exists in ref/.
