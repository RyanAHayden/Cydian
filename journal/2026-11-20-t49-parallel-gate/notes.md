# T49: parallel gate stages

## What changed

`tools/check.sh` starts the native build (`make -s -C native package`) in the background right after the size guard,
in its own process group (`setsid`), with its output in a log. While it runs, the gate runs:

- the Python dirs in `early_dirs` (native/daemon, native/helper, native/sideload/tailscale, native/spike, tools/setup,
  web/app/icons, worker): checked by grep, none of them reads native/build or writes files the build copies;
- the zsign WebAssembly build;
- `node --test web/app` and the worker/test*.mjs loop.

Then `wait_native` collects the build (prints its log, or its last 60 lines and `check: native build failed (make -C
native package exited N)` and exits 1), and the remaining Python dirs run: native/, native/share, native/intents,
native/sideload/idevice (Built cases) and tools/ (test_deploy.py publishes native/build). A new dir runs after the build
until someone checks it and adds it to `early_dirs` (the safe default).

`poll_native` between stages collects a build that has already ended, so a failed build stops the gate at the next
stage. The EXIT trap kills the build's process group if the gate fails before waiting (no build left writing
native/build after the gate exits).

`tools/test_gate_parallel.py`: every early dir exists and none of its tests names native/build; the wait comes after
the early dirs and before the late ones.

## Timings (this machine, other slots running, load ~6)

| gate        | cold (native/build removed) | warm  |
|-------------|-----------------------------|-------|
| before      | 319 s                       | 231 s |
| after       | 219 s                       | 185 s |

Same skip list before and after (only tools/setup's PowerShell test), Python tests 471 → 473 (the two new ones), so
the Built cases ran against a fresh build, not skipped.

## Failing build still fails the gate

Ran the gate with a fake `make` first on PATH that prints an error and exits 2: rc=1, the error printed under
`check: native build output`, then `check: native build failed (make -C native package exited 2)`. 110 s before
`poll_native`, 84 s after (it now stops after the early Python dirs rather than after node too).

## Tried / notes

- A `tail -F | grep -m1` wait for the timing logs hung (tail only dies on its next write); used a polling loop with a
  deadline instead.
- startup.test.js picks a random Chromium debug port in 9400-9899; the native build's bundled-web check now runs it at
  the same time as `node --test web/app`, so two Chromiums can now be up together in one gate. Pre-existing risk
  (other slots already do this); filed B198 (port 0 + DevToolsActivePort).

## Not verified

- A gate without `setsid` (macOS): the fallback path (plain background make, kill by pid only) was not run; no Mac
  gate machine in reach and the native build is Linux-only.
- The early-exit kill of a still-running real build (e.g. a Python test failing mid-build) was not exercised with a
  real build; the fake-make run only covers a build that fails first.
- The timings are single runs on a shared, loaded machine; differences of ±20 s are noise.
