# F74: paid packages, page side after F57

## What I did

- `web/app/screens/extras.js`: Download & Install no longer runs under an "Installing" HUD with only the last stderr
  line on failure. It authorizes the download under an "Authorizing" HUD (the vendor can refuse; that error still goes
  through the Purchase alert), then opens the install queue's console at once (the one-time URL expires in a minute
  or two) and calls `paid.install` with `stream: true`. Paid.swift's `dlstatus:`/`pmstatus:` lines and apt's output
  show as they do for a queue run or Roll Back; a failure shows in red there and is kept in Settings > Console Logs.
  `shell()` takes an optional `onEvent` and passes it to `cydianNative.call`; a shell without `paid.install` still
  says "needs a newer Cydian" (now in the console).
- After the run: waits for the console's dpkg status reload (`catalog.reloadInstalled`), then draws the package page
  again in place (`browse.js render` on the same body and route, scroll position kept), so it shows the Installed
  group, the nav button reads Modify and Remove works without leaving the page. Only when the route is a package page
  and the body is still on screen. `browse.js` is imported late (it imports extras.js).
- `web/app/screens/queue.js` (outside the task's file list, kept small): `runPaidInstall({ id, version, name, run })`
  beside F71's `runRollback`, outside the queue (whatever is queued stays queued), null when a console is already up
  (extras.js then says "Another install is running"). `runConsole` now returns `{ ok, reloaded }` (reloaded: the
  status reload promise it already started) so the caller can wait for it instead of reading dpkg twice. Done in
  queue.js rather than a copy of the console in extras.js: one console, one look.

## Tried and dropped

- Re-rendering into a detached div and swapping it in (no spinner flash): `renderPackage` needs its real body
  (`setRightLabel` and `rememberPackage` look up the page and its nav item from it), so it renders in place.

## Not verified

- No run in a browser or on a phone: the screens have no DOM tests in this repo (node tests cover `core/` and pure
  helpers), and the jailbreak build plus a vendor with a bought package isn't available here. Checked: `node --check`,
  the module imports in node, and the gate. The console flow is the same code path as Roll Back (F71), and the
  bridge side (`paid.install` streaming dlstatus/pmstatus) is covered by `backend-native-paid.test.js` from F57.
- Whether `body.scrollTop` is restored without a visible jump on the phone (page-body is the scroller per style.css).
