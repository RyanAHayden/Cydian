# B194: no Python bytecode in the .deb and IPA

`native/build.sh` `bundle()` copied every file under `web/app/` except the JS tests, dotfiles, zsign and
`core/fixtures/`. The gate's Python tests (`web/app/icons/test_icons.py`, `test_og.py`) leave
`web/app/icons/__pycache__/*.pyc` behind, so those went into both bundles.

## What I did

- Added `! -path '*/__pycache__/*' ! -name '*.pyc'` to the find in `bundle()`.
- Also added `! -name 'test_*.py'`: the two Python test files themselves were shipped too, the same kind of test
  leftover the line already drops for `*.test.js`. Decided to fold it in rather than file a one-clause follow-up on
  the same line.
- Checked the find expression directly in `web/app/`: 324 files before, 322 after (the two `.pyc`), and with
  `test_*.py` excluded the two test scripts drop too. `core/fixtures/tweaks/make.py` was already excluded by the
  fixtures path.

Chose the find filter over a mkdeb/mkipa refusal: the files are regenerated on every gate run, so refusing them
would only fail builds made after a test run without fixing anything.

## Not verified

- A real `native/build.sh` run and a look inside the built .deb/IPA: this machine has no swiftc, ldid or
  rcodesign, so the native build can't run here. The find expression itself was checked in isolation (above).
