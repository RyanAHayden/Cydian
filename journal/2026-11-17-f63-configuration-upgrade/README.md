# F63: Configuration Upgrade in the install queue's console

Cydia's alert when dpkg finds a conffile changed by both the user and the package: "Keep My Old Copy" / "Accept
The New Copy". Before this, N4's `apply` ran apt with `--force-confdef --force-confold` and stdin `/dev/null`, so
the old copy was always kept and the console only said so.

## What I did

- **Helper (`native/helper/`)**: a new verb `apply-ask <items>` (policy.c `queue_plan`, `HV_APPLY_ASK`): `apply`'s
  argv without the two conffile options, and refused without the status fd (the question comes on it). main.c's
  `ask_relay` forks apt-get with a pipe on its stdin instead of `execve`ing it, and copies over from its own stdin
  only the lines `Y` and `N` (`helper_answer_ok`, `\r` allowed). Anything else is dropped with a warning on stderr,
  so the app can't reach dpkg's `D` (pager) or `Z` (root shell). When the app's end closes, apt's stdin closes.
  The loop polls the answer fd at 200 ms and `waitpid(WNOHANG)`s, so the helper ends with apt even while the app's
  end stays open. SIGPIPE is ignored in the helper only (the child gets SIG_DFL back through exec).
- **spawn.c**: `cydian_helper_spawn_in()`: the same spawn with a pipe on the child's stdin (write end returned).
  `cydian_helper_spawn()` is now a wrapper, unchanged for its callers.
- **Apt.swift**: `Helper.run` spawns `apply-ask` with that pipe (`F_SETNOSIGPIPE` on it) and keeps its fd in
  `Helper.answerFd` while it runs; the bridge method `helper.answer {answer: "keep" | "new"}` writes `N\n` / `Y\n`.
  One console runs at a time, so one slot is enough.
- **backend-native.js**: `apply(jobs, onEvent)` runs `apply-ask` when there is an `onEvent` (someone to ask),
  plain `apply` without one (so dpkg keeps the old copy, as before). New `answerConffile(answer)`.
- **Console (screens/queue.js)**: a `conffile` status line opens the alert (core/queue.js's `CONFFILE_*`,
  Cydia's strings from docs/cydia.md); the answer goes to `answerConffile` and the console logs
  "Configuration file X: keeping your copy" / "installing the package's new copy". Alerts are chained, and one
  answered after the run ended sends nothing. Roll Back's console (`asks: false`) keeps the old wording, since
  `rollback` still uses `--force-confold`.
- **nav/alert.js**: a `stacked` option. The two titles were cut off side by side ("Keep My …", "Accept T…");
  UIAlertView stacks buttons that don't fit, so the alert passes `stacked: true`. This file is outside the task's
  file list; the change is one option, nothing else touched.
- **Fake (`native/fake/`)**: `cydian-helper apply-ask`, and `FAKE_CONFFILE=<path>`: after the first install
  item's unpack, apply keeps it quietly, apply-ask prints dpkg's prompt, writes the `pmconffile:` line on fd 3 and
  reads `Y`/`N` from stdin (other lines warned and skipped, end of file is dpkg's error, exit 100). The outcome is
  logged to `$CYDIAN_PREFIX/var/fake-conffiles`. `fake-native.mjs` gives apply-ask a stdin pipe and answers
  `helper.answer`.

## Tests

- `native/helper/test_helper.py`: `test_apply_ask_plan` (argv, no fd refused, name and empty refusals) and
  `test_chain_apply_ask`: the stand-in Cydian (`test_driver spawn-ask`) sends `Z,D,maybe,Y`, and the stand-in apt
  reads `Y` with three warnings on stderr; the app's end held open with `N` still ends with apt's exit; no answer
  plus closed is end of file; plain `apply` still reads `/dev/null` even when the app gives a pipe; no extra fd
  reaches apt.
- `web/app/backend-native-queue.test.js`: apply asks, the answer goes back, and the fake records `new` / `keep`;
  `answerConffile` refuses with no run waiting and a word that isn't keep/new; apply with no console runs plain
  `apply` and keeps the old copy.
- `web/app/core/queue.test.js`: the alert's strings and the index-to-word mapping.
- Walk-through (`tools/serve.mjs`, `tools/shots.mjs`, chromium headless at 390x844 3x): `shots/a*` Downgrade
  to 0.9, answered Accept The New Copy; `shots/b*` Upgrade to 1.1, answered Keep My Old Copy. No page errors.

## Tried and dropped

- Piping the app's stdin straight to apt (no relay in the helper): less code, but the app could then send dpkg
  `Z` and get a root shell outside the helper's one-command rule. The relay keeps that rule.
- First run of the walk-through queued "install 1.0", which the fixture lists don't have ("Cannot Comply"). The
  script now queues the newest version for run b.

## Not verified

- **On a phone**: no iOS run. Real dpkg/apt with a pipe on stdin, apt's real `pmconffile:` line, and the persona
  spawn with a stdin pipe weren't tried on a device. The task doesn't allow touching the 4S, and it runs iOS 6,
  not the rootless iOS 15+ target. From apt's dpkgpm.cc and Cydia's own use (it also writes `N\n`/`Y\n` to a
  pipe), dpkg reads the answer from a pipe without needing a tty, but I didn't watch it happen.
- **Apt.swift** is checked only by the gate's native build (compile and link). `helper.answer` and the stdin
  pipe weren't run.
- **Maintainer scripts that read stdin** now read the relay's pipe under `apply-ask`. With nothing written they
  wait, where `/dev/null` gave them end of file. Cydia runs apt the same way, so packages made for it should cope,
  but a script that blocks on stdin would hang the run (until the app is quit). Not tested with a real
  package.
- Dark theme shots weren't taken (the console is black in both themes; the alert is the same).
