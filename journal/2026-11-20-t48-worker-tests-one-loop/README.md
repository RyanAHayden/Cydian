# T48 Worker tests in one loop

## What changed
- `tools/check.sh` runs every `worker/test*.mjs` with node in a loop (fails with the file's name), in place of
  `node worker/test.mjs`; the header comment says so.
- Deleted `worker/test_github.py` and `worker/test_reports.py` (they only ran `test-github.mjs` / `test-reports.mjs`
  under unittest).
- Dropped `await import("./test-push.mjs")` at the end of `worker/test.mjs`; the loop runs it directly. Its header
  comment ("Run from worker/test.mjs") and the README's gate line now say the gate runs each file.

## Check: same node tests
`": ok"` lines per file, each run by hand with node:

| file | before | after |
|---|---|---|
| test.mjs | 24 (23 + push via import) | 23 |
| test-push.mjs | (inside test.mjs) | 1 |
| test-github.mjs | 1 (via test_github.py) | 1 |
| test-reports.mjs | 1 (via test_reports.py) | 1 |
| total | 26 | 26 |

`worker/test_entry.py` is a real Python test (wrangler configs, node.mjs), not a wrapper, so it stays.

## Not verified
none
