# F234: install queue run where one failure doesn't stop the rest

## Decision: own Queue screen or rows inside Confirm/progress?

Rows on the existing black progress page (nav/progress.js), not a separate Queue screen. The user settled it
on 2026-11-18 (plan note): Confirm stays as it is (Continue Queuing, Statistics, Modifications), and the run
gets a Packages | Log segmented control in the black page's nav bar. Packages (one row per package) is the
default view; Log is the console as before.

## What was built

- `web/app/core/installrun.js` (pure, tested in `installrun.test.js`):
  - `runRows`: one row per package apt's plan changes. Removals go first, then the queue's order with each
    package after the rows it needs (a DFS over Depends / Pre-Depends inside the plan; a loop is cut).
  - `deadRows`: the re-plan. A row is lost when every alternative of one of its dependency groups names a dead
    row (failed, cancelled, or skipped for one of those), and no installed version of it satisfies the relation.
    A name that isn't a row (already installed, virtual, provided) always counts as there. This repeats until
    nothing changes, so dependents of dependents are skipped too, each with the failure at its root ("Needs X,
    which failed").
  - `createInstallRun`: the scheduler. Downloads run 3 at a time in lane order; one dpkg lane installs the
    first row that hasn't ended once it is ready (strict queue order). Also `stop(id)` (a row's stop button),
    `cancel()` (downloads stop now, the row dpkg is on finishes), `retry(id)` (a skipped row retries its cause
    first), and `retryAll()` (failed, skipped and cancelled rows).
  - `rowStatus`, `summaryLine` ("4 installed, 1 removed, 1 failed, 1 skipped, 2 cancelled"), `runStatus`, `runPercent`.
- `catalog.runInfo([{id, version}])` (core/catalog.js, worker op, catalog.js): each version's stanza gives
  debUrl, hashes, size, Depends and Pre-Depends, plus dpkg's versions of every name those depend on.
- `backend-native.js`:
  - `queueFetch` downloads through `share.debFetch` (the stanza's SHA256/MD5 is checked by the shell, F133),
    with progress and a tag.
  - `queueInstall` installs a fetched file through `share.debInstall` (`install-deb`). A removal, or a row the
    shell couldn't fetch, goes through `apply-ask` for that one item, so a conffile can still be asked about.
  - `markAuto` calls `ifizbox-helper auto`.
  - Failures: a bad hash or a file that isn't a .deb fails the row. Any other fetch failure hands the row to
    apt in the install step (`viaApt`: "Downloading and installing"). The exception is a full-URL Filename
    (F131), which apt can't fetch, so it fails.
- `native/share/App/ShareBridge.swift`: `share.debFetch {stream, tag}` sends `{progress}` events (one per whole
  percent), and `share.debCancel {tag}` stops it (Download.cancel).
- `ifizbox-helper auto <pkg>...` = `apt-mark auto`. Each one-package `apt-get install ./x.deb` (or `name=ver`)
  marks the package manual, which would put apt-added dependencies into Installed's User list (F130 reads
  extended_states). At the end of a run, the newly installed packages that apt only pulled in get their mark
  back. Tests are in test_helper.py; the verb is in README and main.c's header.
- `web/app/screens/queuerun.js`: the page. Packages rows show a name, a grey status, an iOS 6 UIProgressView bar
  (sampled from UIProgressBarOuter/Inner_Default) and a stop disc. Log lines carry their package (`page.line(kind,
  text, pkg)`), and each step shows once per package and pass. Top left is Hide while running (a strip under the
  nav bars reopens it, and the Installed badge counts what's left) or Close after failures. Top right is the red
  Cancel ("Stopping after X…", greyed), Retry All, or Done. The summary row goes at the end of the list and the
  log; the finish button is chooseFinish over what installed ("Return to <NAME>" when plain).
  - On Cancel: the page closes, and Confirm reopens with the footer "Stopped. N installed and cleared from the
    queue."
  - Installed rows leave the queue as they finish. Failed, skipped and cancelled rows stay queued.
  - F189 waiters get each package's own outcome when the page closes.
- `nav/progress.js` additions (all optional, the old callers are unchanged): `line(kind, text, pkg)`,
  `filter(pkg)`, `segmented(labels, onPick)`, `pane(node)` and `view()`, `bar({left, right})`, `hide()` and `show()`.
- Confirm's Modifications: a package apt added gets a grey "needed by X" line (`markNeededBy`, from runInfo).
- `screens/queue.js`: Confirm's Confirm runs `runQueueRun` when the backend has `queueFetch` (the jailbreak
  app); otherwise, and for Roll Back and paid installs, the old console.
- `queue-confirm.test.js`: the "only Confirm's Cancel is red" rule now allows the run's Cancel too (the user's
  design asks for it).

## Judgement calls

- A failed or skipped row's tap retries it (as the brief says). Any other row's tap opens the Log filtered to
  that package. A failed row's error is in its own grey line, and the full log is one tap away (Log).
- The dpkg lane follows strict queue order: a slow download early in the lane holds the installs behind it,
  even unrelated ones. The brief says "in queue order", so I kept that.
- Downloads go through the shell, not `apt-get install --download-only`. Parallel apt-get runs fight over
  `/var/cache/apt/archives/lock`, and the app (mobile) can't stop a root apt-get it didn't spawn with a pipe.
  The shell's Download already has cancel and progress. This needed no new helper verbs for download/install,
  only `auto`.
- Linked debs (F131) are fetched again at run time; the copy `simulate` staged is discarded when the queue clears.

## Known gaps (filed as follow-ups)

- **http repos fall back to apt.** App Transport Security keeps URLSession off plain http (see Icons.swift,
  B58). For an http source (BigBoss and others), share.debFetch fails, and the row downloads through apt
  inside its install step, so it is not in parallel and has no per-row progress. Failures still stay per
  package. Fix: fetch .debs over Network.framework for http, as net.icon does.
- **No conffile question on the install-deb path.** A row the shell fetched installs through `install-deb`,
  which keeps the old conffile (--force-confold). Rows apt downloads (and removals) go through apply-ask and
  are asked.

## Tried and dropped

- At first, the scheduler's progress hook took (done, total) bytes, but the shell only knows a fraction. It
  now takes a fraction 0..1, and the row's MB comes from the stanza's Size.

## Device check (iPhone 7)

(see below)

## Not verified

(see below)
