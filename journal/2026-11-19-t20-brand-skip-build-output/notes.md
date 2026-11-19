# T20: test_brand.py ignores git-ignored build output

## What I did
- `native/test_brand.py`: `code_files` now yields only files that
  `git ls-files --cached --others --exclude-standard` lists (the same listing `tools/check.sh` uses), so anything
  git-ignored, like `worker/.wrangler/tmp/*` after `wrangler dev`, is skipped. It also leaves out `.wrangler` and
  `.preview-site` by directory name, because `worker/.preview-site` is not git-ignored in this tree yet (only
  `worker/.wrangler/` is, in `worker/.gitignore`), so the git listing alone would not skip it.
- Added a top-level `import subprocess` (the other tests import it inside each function).

## Checks
- Put copies of `web/app/brand.js` into `worker/.wrangler/tmp/` and `worker/.preview-site/`. The new file passes
  (12 tests). The old file from HEAD, run on the same tree, fails `NoOldName::test_worker`. Removed the copies afterwards.
- `tools/check.sh` runs through `agent-runner done`.

## Not verified
- I did not run a real `wrangler dev` or preview build. I used copies of brand.js in their output directories to
  stand in for that output.
