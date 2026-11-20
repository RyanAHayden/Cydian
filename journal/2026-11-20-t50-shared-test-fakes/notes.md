# T50: shared frontend test fakes

## What I did

- `web/app/fakes.test-helper.js`: the shared fakes for `node --test` files.
  - `fakeDocument`, `fakePage`, `tick`: re-exported from `nav/fakedom.test-helper.js` (unchanged).
  - `fakeNative(answers, { mode = "sideload" })`: the bridge fake that four tests had copied word for word
    (answers[method] is a value, an Error to throw, or fn(params, onEvent); `calls` records { method, params }).
  - `memStorage(init)`: a Storage in memory with getItem/setItem/removeItem/clear/key/length, exposing its Map as both
    `m` and `map` (the two names the copies used).
  - `fakeIndexedDB()`: a superset of the ten copies: get, getAll, getAllKeys (sorted), put, delete, clear; writes
    outside "readwrite" throw; a transaction completes after its last request (changes.test.js's behaviour); the db
    keeps `stores`, `version` and `closed` (cache.test.js looks at these).
- Migrated, one folder per commit:
  - `core/`: 9 fakeIndexedDB copies and 18 storage copies.
  - `web/app/` top level: 3 IndexedDB copies (backend-native, -github, -tweaksources), 4 fakeNative copies, 12
    storage copies.
  Copies under another name (`memoryStorage`, `memStore`, `memory`, `fakeStorage`, `memoryIndexedDB`…) are imported
  with `as`, so the test bodies did not change.
- Left alone on purpose: inline one-off stubs that do something else (a storage that throws, one keyed to a single
  key, theme-palette's that drops null seeds, ones that set `globalThis.localStorage`), and the variant fakeNatives
  with their own shapes.
- Follow-ups filed: T50a (screens/ fake DOM copies), T50b (nav/ fake DOMs, the 8 importers of
  `native/fake/fake-indexeddb.mjs`, the remaining fakeNative variants).

## What went wrong

- The brief named the file `web/app/test-fakes.js`. Node's default test pattern includes `**/test-*.js`, so
  `node --test web/app` ran it as a test file: 2491 tests instead of 2490. Renamed it to `fakes.test-helper.js`,
  which follows `nav/fakedom.test-helper.js` and matches no test pattern. Name any future shared helper the same
  way (`*.test-helper.js`).
- The stricter superset (read-only writes throw, completion after the last request) broke no test: the code under
  test always opens readwrite to write.

## Check

`node --test --test-reporter=tap web/app`, sorted `ok` lines diffed against a scratch worktree at the commit before
the work: same 2490 test names, all pass.

## Not verified

none
