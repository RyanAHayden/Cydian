# C59: remove native/fake/fake-indexeddb.mjs

- `git grep -i "fake-indexeddb\|indexeddb.mjs"` outside `journal/` and `plan/` found nothing: no test, script,
  Swift file or doc imports or names it (native/README.md's `fake/` list never mentioned it). Since T50b the tests
  take `fakeIndexedDB` from `web/app/fakes.test-helper.js`.
- Deleted the file. Nothing else changed.

**Not verified**: none (the gate, `tools/check.sh`, runs through `run done`).
