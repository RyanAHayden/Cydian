# T30: test_setup.Cargo.test_cli_builds failing under load

## What it raced

Not load or time: another checkout's files. The merge gate log (`~/repos/iFizBox/.runner/merge-gate.log`) showed:

    failed to run custom build command for `ifizbox-setup (/home/ryha/runs/iFizBox/merge/tools/setup/cli)`
    .../setup-target/cli/debug/build/ifizbox-setup-d047478be1d16ddc/build-script-build (exit status: 101)
    panicked at build.rs:8:60: /home/ryha/runs/iFizBox/take-F285/tools/setup/cli/../../../native/brand.env: No such file

- The test's cargo target dir (`~/.cache/ifizbox/setup-target/cli`) is shared by every checkout, on purpose (idevice
  is slow to build).
- cargo's hash for a path package's build script leaves out the absolute path, so every checkout uses the same
  `build/ifizbox-setup-<hash>/build-script-build`. Freshness is by mtime: a checkout whose build.rs is older than the
  last compile (a long-lived worktree like `merge`) reuses the binary another checkout compiled.
- build.rs baked in `env!("CARGO_MANIFEST_DIR")` at compile time, so the reused binary read brand.env from the
  checkout that compiled it: `take-F285`, deleted once F285's own session ended. Whether it failed depended on which
  checkout compiled last and whether that one still existed, which is why it "passed alone".

Reproduced in the scratchpad with two copies A and B and one target dir: build A, delete A, build B (build.rs
mtime older): the same panic naming A's path. With the fix: B passes and the script reruns with B's path.

## Fix

- `tools/setup/cli/build.rs`: read `CARGO_MANIFEST_DIR` with `std::env::var` when the script runs. The hunk is the
  same as B149's (task/B149 made the same change while T30 was queued), so the merge of both is clean.
- `test_setup.py`: the cli target dir is now `setup-target/cli-rt`, so binaries that pre-fix checkouts compiled
  into `cli` (still running on older branches) are never reused by a fixed checkout.
- New `BuildScript.test_no_compile_time_paths`: build.rs must not use `env!`/`option_env!`/`include_*!`.

The old `~/.cache/ifizbox/setup-target/cli` is left alone: older checkouts may still use it. It can be removed
once no branch from before this fix is left.

## Not verified

- A gate run with several slots building at once: the root cause is the reused binary, not timing, and the
  scratchpad reproduction covers it. The full gate runs through `run done`.
