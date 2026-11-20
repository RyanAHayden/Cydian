# T47: releases refuse stray files in web/app/

## What I did
- New `tools/stray-check.sh [ROOT]`: `git ls-files --others -- web/app` (no `--exclude-standard`, so ignored files
  count too); exits 1 listing them (first 20). One helper so both release scripts apply the same rule.
- `tools/release.sh` runs it right after the `--check-auth`/`--verify-*` modes, before anything else, dry runs
  included (the dry run is "the release check"). `tools/setup/release.sh` runs it for `--dry-run` and the real run,
  not `--probe` (that only looks at toolchains). `IFIZBOX_STRAY_ROOT` points both at another checkout (tests).
- Tests: `tools/test_stray_check.py` (throwaway git repos): clean passes, ignored `web/app/dl/Cydian.ipa` and an
  untracked `.js` refused, files outside web/app/ ignored, and both scripts' dry runs exit 1 naming the file
  before building anything. `tools/test_release.py`'s dry runs now point the check at an empty repo, so a leftover
  in the checkout running the gate (the main checkout has web/app/dl/Cydian.ipa) doesn't fail unrelated tests.
- docs/release.md step 3 mentions the check.

## Decisions
- Tolerated: `__pycache__/*.pyc` and `web/app/build.json`. The gate's own Python tests (web/app/icons/test_*.py)
  write pycache into web/app/ every run, so refusing them would make every release after `tools/check.sh` fail.
  They do still get bundled by native/build.sh: filed B194 (low) to keep them out of the builds.
- setup/release.sh doesn't bundle web/app/ itself; the check is there because the task asks for both scripts
  and it releases from the same checkout.

## Not verified
- A real (non-dry) run of either script: they publish to GitHub; the check sits before any mode split, so the same
  code path runs.
- `tools/publish.sh` builds in a fresh temporary worktree, where web/app/ is clean by construction; not exercised.
