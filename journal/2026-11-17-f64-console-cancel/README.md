# F64: Cancel in the install console while apt downloads

## What I did

- **How the signal gets there.** The brief said to signal the helper's child from the app using the pid that
  Helper.run keeps. That can't work: the helper runs as root (persona uid 0, native/helper/spawn.c) and the app runs
  as mobile, so `kill()` from the app gets EPERM. So Cancel goes over the stdin pipe that apply-ask already has
  for F63's conffile answers:
  - `native/helper/main.c` ask_relay: a `C` line (`helper_cancel_ok`, policy.c) is never passed on to apt. The
    helper (root, and apt-get's parent) sends apt-get `SIGINT` and writes `cydian-helper: cancelled: stopping
    apt-get` to stderr. While apt downloads, SIGINT ends it with exit 130. Nothing is unpacked, and the partial files
    stay in archives/partial. SIGINT rather than SIGTERM: if a Cancel ever races dpkg's start, apt's own SIGINT
    handler lets the running dpkg call finish and stops after it, instead of leaving a half-unpacked package.
  - `native/Sources/Apt.swift`: the bridge method `helper.cancel` → `Helper.cancel()` writes `C\n`. It refuses
    with a `helper:` error when nothing runs, or once dpkg has started. "dpkg has started" means apply-ask's
    status fd showed a `pmstatus:`, `pmconffile:` or `pmerror:` line. The reader thread now splits fd 3 into lines
    for apply-ask even without `emit`, so it can watch for them. Nothing changed in Bridge.swift:
    Apt.register already holds the helper's methods.
  - `web/app/backend-native.js`: `cancelApply()`.
  - `web/app/screens/queue.js`: the console has a Cancel bar button on the left for queue runs (asks: true and a
    backend with cancelApply). It is not shown for Roll Back or Paid Install, whose verbs read no stdin. The button
    hides at the first pm* status line and when the run ends. After a cancel the console says "Cancelled. Nothing
    was installed or removed; the queue is kept." and the status reads Cancelled. The queue is kept because the run
    is not ok. The log entry records code 130.
- Fakes: `native/fake/fake-native.mjs` has `helper.cancel`, which sends SIGTERM (not SIGINT: under the gate, started in the background, children inherit SIGINT ignored; the first gate run failed on exactly that) to the helper's process group and reports 130. The
  fake helper is now spawned detached, so a `sleep` dies too. A run killed by a signal now reports 128 + its signal
  number, where it used to report 128. `native/fake/cydian-helper` apply/apply-ask now downloads every item first
  (dlstatus lines), then runs dpkg (pmstatus), as apt does. A new `FAKE_DLWAIT` holds the run between those two
  steps.
- Tests: `native/helper/test_helper.py` test_chain_apply_ask_cancel runs the real helper with a fake apt-get blocked
  on stdin; it gets SIGINT, exits 130 and never reads the `C`. `web/app/backend-native-queue.test.js` has two F64
  tests: cancelling during the download leaves dpkg's status untouched and returns code 130, and cancelApply is
  refused once dpkg runs and when nothing runs.

## Tried and failed

The pid approach was dropped on reading spawn.c, before any code was written. The first gate run failed the new F64 backend test (exit 0 after 20 s, not 130): the gate runs node with SIGINT ignored, which the fake helper shell inherited. The fake now cancels with SIGTERM.

## Not verified

- **Swift side not compiled**: there is no swiftc on this machine. Apt.swift's `helper.cancel`/`Helper.cancel` and
  the status-line watch were checked only by reading.
- **Not run on a phone**: I didn't check how real apt behaves on SIGINT during the download (I expect exit 130,
  with the http methods exiting when their pipe closes and the lock released), or that apt's SIGINT handler stops
  after the current dpkg call if a Cancel races the switch to dpkg. That needs a jailbroken device and a real
  download. The task didn't ask to use the 4S, and AGENTS.md says to touch it only when a task says so.
- **The console's Cancel button was not checked in a browser** (no screen test drives runConsole). It uses the
  console's existing bar-button style.
