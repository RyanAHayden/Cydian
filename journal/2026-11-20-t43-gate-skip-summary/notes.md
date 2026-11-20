# T43: the gate lists what it skipped

## What changed

- `tools/gate_unittest.py`: runs one directory's `test_*.py` the way `python3 -m unittest discover -q -s D -t D`
  did (same discovery, working directory first on `sys.path`), and appends each skipped test to a file as
  `<dir>: <test id>: <reason>` (reason folded to one line). Exit 0 pass, 1 fail, 5 no tests. Stdlib only.
- `tools/check.sh`: keeps a temp skip file; the Python runs use the helper, and the native-build and zsign-build
  "skipped" lines are also added to it. At the end it prints `check: skipped (N):` with one indented line per skip,
  or `check: nothing skipped`. With `IFIZBOX_GATE_STRICT=1` any skip makes the gate exit 1 after the summary.
  I counted the build skips too, not only Python tests: the brief says "fail on any skip", and a missing toolchain
  is the other silent skip the audit named.
- `tools/test_gate_unittest.py`: a method skip and a `setUpClass` SkipTest are written with their reasons and
  still pass; a failure exits 1 with nothing listed.

## Checked

- Full gate on this machine: passes and ends with
  `check: skipped (1): tools/setup: test_setup.InstallPs1.test_parses: no PowerShell on this machine`
  (a real skip nobody had seen before). Native built here and cryptography is installed, so those didn't skip.
- Same gate with `IFIZBOX_GATE_STRICT=1`: same summary, then
  `check: IFIZBOX_GATE_STRICT=1 and something was skipped: failing`, exit 1.

## Not verified

- The signer tests' own skip without `cryptography`: this machine has the package and I didn't uninstall it; the
  helper's test covers the same path with a forced skip.
- The native/zsign "build skipped" lines in the summary: both toolchains are present here, so those branches only
  ran as code review (each is the existing echo with `| tee -a "$skips"`).
- Strict mode can't pass on this machine while PowerShell is missing; that's the intended behaviour, not a bug.
