# T50b: shared test fakes, nav/ pass and leftovers

## What I did

**nav/ fake DOMs onto `nav/fakedom.test-helper.js`** (8 files): alert-paste, searchbar, segments, sheet,
reloadbar, rowswipe, menu-hold, queuehint. Each now builds on the shared `fakeDocument()`; what stays in the
test is a thin layer for that test's needs, not DOM behaviour:

- alert-paste: keeps every created element in `all` (wraps `createElement`).
- searchbar: `focused` tracking and a synchronous `fire()` that says whether preventDefault ran.
- sheet: `focused`, and animations recorded in `doc.anims` that finish only on `end()`; `animate: false` deletes
  `animate` from every node (sheet.js's no-animation path).
- reloadbar: `animations` per node, and the small innerHTML parser for the bar's `<svg>/<span class>` markup.
- rowswipe: `clientWidth` and a `fire(t, e)` that passes the test's event object as it is.
- menu-hold, queuehint: listeners kept by capture/bubble phase in `on` (their own dispatch() walks
  `parentNode` now instead of the old `parent`), and the sizes/rects their layout reads. queuehint's tabs are
  `<a>` elements now, because the shared `closest("a.tab")` checks the tag (the old one ignored it).

Left as they are: progress.test.js's `fakePage` (a progress-page stand-in, not a DOM), tapguard's `fakeDoc` (an
event target only), pullrefresh's B209 stand-ins and slide/statusbar's layout trees (box geometry, not DOM).

**fake-indexeddb.mjs**: the 8 tests that imported `native/fake/fake-indexeddb.mjs` (app-updates,
backend-native-appversions/-linked/-live/-queue/-queuerun/-rollback, core/keepawake) import `fakeIndexedDB` from
`fakes.test-helper.js`. None of them needed anything only the .mjs had. Nothing imports the .mjs any more; it is
outside this task's files, so its removal is filed as a follow-up.

**fakeNative variants**: of the 13 local `fakeNative`s, 6 have the shared shape (an answer per method) and now use
`fakeNative(answers)` from `fakes.test-helper.js`: self-update-lock (identical), signing-client-original,
signing-client-sent, screens/apprun, screens/b136-swipe, core/push. Where the old fake recorded calls as names or
`[method, params]`, the test reads the shared `{ method, params }` records through a one-line view (`sent()`,
`called()`) or the assertion was rewritten to the object form. Unlisted methods now answer `null` instead of `{}`;
every test still passes.

Left, because they are a different shape:
- signing-client-ready: a sequence of answers to one method (and asserts the method).
- incoming-ipa-signing, backend-native-github, -bz2, -tweaksources: strict routers that throw on any method they
  don't know (incoming's as the shell's `unknown method`, code internal); the shared fake answers null instead,
  which would hide an unexpected call.
- signing-client-insecure: the answer depends on `params.insecure`.
- settings: leaves app.shortcuts out of `calls` and spreads overrides over the fake.

## Check

`node --test --test-reporter=tap web/app` at the branch start and after: 2694 tests, 2694 pass both times, and
the sorted `ok` names diff empty.

## Tried / failed

- menu-hold first failed in one test (`make is not a function`): a third call site built a button through the old
  `fakeEl(tag)`; it uses `doc.createElement` now.
- I made two of the edits (searchbar's helper block, reloadbar's import line) with a short python / sed command
  before going back to the file-edit tool; both were read back and tested.

## Not verified

none (the gate `tools/check.sh` runs in `done`).
