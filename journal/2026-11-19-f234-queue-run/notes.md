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

## Known gaps (filed as follow-ups F238, F239, B70)

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

- The shell's split errors: bridge.js turns `bad_hash: …` into `e.code` plus an unprefixed message, and the
  wrapper `backendError` then dropped the code. So the `^bad_hash:` / `^gone:` checks never matched in the
  app; the node fakes throw prefixed messages, so tests never showed it. That also hit F131's linked-deb
  bad-hash and gone checks. `backendError` now keeps a code the proxy doesn't share in front of the message.
  Found on the phone (run 1 below).

## Device check (iPhone 7, 0.9.8-1599 then 0.9.8-1600 of this branch)

The test repo was a flat repo of three empty packages built on the phone with dpkg-deb. `f234test-bad`'s
Packages stanza lists an all-zero SHA256 and MD5; `f234test-needsbad` depends on it; `f234test-ok` stands
alone. It was served from the desktop with `python3 -m http.server` through `ssh -R` (the phone can't reach
the desktop's port directly), so the phone sees it at http://127.0.0.1:18734/. The source was a
`[trusted=yes]` file in sources.list.d. I queued needsbad (apt added bad) and ok from their package pages,
then tapped Confirm.

- Confirm's Modifications showed "needed by F234 Test needsbad" in grey under F234 Test bad.
- Run 1 (build 1599): bad ended Failed, needsbad was Skipped ("Needs F234 Test bad, which failed"), and ok
  ended Installed. The end showed "1 installed, 1 failed, 1 skipped" at the end of the list and the log, Close
  / Retry All, and "Return to iFizBox". So the brief's check (a queue with one bad-hash package installs the
  others) passed. But bad failed in apt (Hash Sum mismatch, after a viaApt fallback), not in the shell's
  check: that is how I found the split-error bug above. The row also showed apt's last error line ("Unable to
  fetch some archives…"); it now shows the first one (the cause).
- Run 2 (build 1600, both fixed): bad failed in the shell's hash check ("the download isn't the file its
  source lists…"), needsbad was skipped, and ok was installed. Retry All ran a second pass with the same result
  (the log has both passes). Tapping a failed row retried it. Tapping the installed row opened the Log filtered
  to that package. After Close, the Installed tab showed Q'd and Queue, and Confirm listed only needsbad (ok had
  left the queue). Confirm's Cancel cleared it.
- The Log: one bold line per step per package (Downloading X, Downloaded X, apt's Preparing / Unpacking /
  Installing / Configuring once each, Installed X), with apt's and dpkg's own output grey under it.
- http to 127.0.0.1 worked from the shell (ATS lets IP addresses through), so needsbad and ok were fetched by
  share.debFetch. But apt-get install of the fetched ok file downloaded ok again from the source ("Get:1
  http://127.0.0.1…"). When the local .deb has the same version and hash as the source's, apt 2.9.4 takes the
  repo copy. That is harmless here, but it is a second download. Noted below.
- Cleanup: f234test-ok was removed and the test source, its lists and /tmp files were deleted; this branch's
  iFizBox (0.9.8-1600) stays installed. The local http server and the ssh tunnel run under `timeout 5400` and
  stop on their own. I had no pid to stop them earlier, and the rules forbid a pattern kill.

Screenshots are in ref/7/screens/f234-*.png (main checkout's ref/, gitignored).

## Not verified

- **Hide and its strip, Cancel ("Stopping after X…", back to Confirm with the Stopped footer), and a row's stop
  button on the phone.** Three tiny packages finish in about a second, so there was no running page to tap.
  They are covered by the node tests (installrun.test.js for cancel and stop) and by reading the code; the
  strip's look (queue.css .qr-strip) was never seen on a screen.
- **The progress bar and indeterminate sweep, and the segmented control's pressed look.** The bars only show
  while a row downloads or installs, which these runs never held long enough for a screenshot. The segmented
  control's resting look was seen on the phone; the CSS is from sampled 4S art, but no 3x zoom comparison
  against the kit was made.
- **The last polish after run 2** (KB for packages under 1 MB, the shorter bad-hash line with the full sentence
  as a grey log line): node tests only, not rebuilt onto the phone.
- **`ifizbox-helper auto` on the phone.** These runs installed no apt-added package (bad always failed), so
  markAuto never ran there. The helper verb is tested on Linux (test_helper.py).
- **Conffile questions in the run, a removal row, an upgrade's re-plan with an installed version standing in, and
  F189 waiters (an IPA waiting on AppSync).** Node tests only.
- **The apt double download.** When a shell-fetched .deb matches the source's version and hash, apt fetches the
  source's copy instead of the local file. Seen with ok in run 2; not worked around (a repo that answers apt
  with 418, like Havoc, would fail such a row even though the shell fetched it).
