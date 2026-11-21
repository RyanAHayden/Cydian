# B222: the concept's app without IndexedDB (opaque origin)

B210 saw it in iPhone Safari with a concept page in a `data:` tab: Sources showed `IDBFactory.open() called in an
invalid security context`, and Home's green tile said Add a Source. An opaque origin refuses IndexedDB, and
`tools/concept/shell.js` stood in for localStorage only.

## Does the claude.ai Artifact viewer's frame refuse IndexedDB?

From what I can find out here: no, not normally. The Artifact tool's own page contract says "`localStorage` (also
`sessionStorage` and IndexedDB) works, but each artifact has its own origin", so the viewer gives each artifact a
real origin. The concept's phone is a `srcdoc` iframe with no `sandbox` attribute (frame.html), so it shares that
origin. The same contract also says storage "can come back empty or the accessor can throw (a private window,
cleared or blocked site data, previews or thumbnail capture)". So the fallback still matters in the viewer at
times, and for any page opened in an opaque origin (a `data:` tab, a sandboxed frame).

## What changed

- `tools/concept/shell.js`
  - `window.indexedDB` is a small factory now. It uses the browser's own IndexedDB until `open()` (or
    `deleteDatabase()`) throws a refusal (`SecurityError`, or a message with "security context"), or until
    reading `window.indexedDB` throws or gives nothing. After that, `memoryIndexedDB()` answers every call. Where
    IndexedDB works, nothing changes: the real request goes straight back to the app. `indexedDB.memory` says
    which one answers (check.mjs reads it).
  - `memoryIndexedDB()` covers what web/app asks of IndexedDB: `open` with versions and `onupgradeneeded`
    (`createObjectStore` / `deleteObjectStore`; an aborted upgrade leaves the database as it was), `VersionError`
    on a lower version, inline (`keyPath`) and out-of-line keys, `get`, `getAll`, `getAllKeys`, `count`, `put`,
    `add` (`ConstraintError`), `delete`, `clear`. Values are cloned, results come back in IndexedDB's key order,
    transactions complete once their requests settle, and a request error that nothing prevents aborts its
    transaction and undoes its writes. It starts empty with each app load, and the stores seed their defaults
    again.
  - `navigator.serviceWorker`: an opaque origin throws on reading it, and app.js reads it. In the website mode the
    sandboxed run hit this right after the IndexedDB fix. Where reading it throws, the shell makes it `undefined`.
- `tools/concept/check.mjs`: after the matrix, it serves the page again at `/sandboxed` (CSP `sandbox` without
  `allow-same-origin`). Then it does one run per mode at the first device: the app came up, the phone's origin is
  `"null"`, `indexedDB.memory` is true, Sources lists source rows with no IndexedDB refusal, Home's tile isn't
  Add a Source, there are no errors and no requests. The phone's frame is cross-origin to the page there, with no
  `contentDocument`. So `inApp` runs in the frame's own execution context for that pass (the newest default
  context that isn't the top frame's), as B210's `probe-concept.mjs` did.
- `tools/concept/idb.test.mjs` + `test_shell_idb.py` (in the gate): they run `memoryIndexedDB()`, cut out of
  shell.js, under web/app's own stores (`openSourceStore` with seeding, `openIndexCache`, `openSeenStore` with 500
  puts in one transaction, `openAppStore`). They also test out-of-line keys, an `add` conflict aborting and undoing
  its transaction, a read-only write refused, an upgrade to version 2 and a `VersionError`.

## Checked

- Before the fix, check.mjs's new pass failed in the jailbreak and Lite modes, as B210 reported: `Sources lists its
  sources (0 rows)` and `Home's tile isn't Add a Source`. The website mode passed with 2 rows. After the
  shell.js change: jailbreak 4 rows, Lite 4 rows, website 10 rows, all clean (after the serviceWorker fix too).
- The full default matrix with all three modes (iphone-se and iphone-17-pro-max × light:classic and dark:gunmetal,
  drag checks, then the sandboxed pass): 311 ok, "concept check: all clean". After the review narrowed the
  refusal check, I re-ran the sandboxed pass (iphone-se, dark:gunmetal, all three modes): all clean, and the stand-in
  answered in each mode.

## Review (spec axis)

- Fixed: the refusal check matched any message with "denied". It now matches only `SecurityError` or
  "security context".
- Kept, though not in the brief: the `navigator.serviceWorker` guard (the sandboxed website run fails without it),
  the gate test (`idb.test.mjs`, `test_shell_idb.py`: it tests this change), and `databases()` / `cmp()` on the
  factory (part of IndexedDB's surface, a few lines).
- The review also noted that the stand-in matches exact keys only, not `IDBKeyRange`. web/app uses no key ranges,
  indexes or cursors.

## Tried and failed

- The first sandboxed pass found no app ("the app came up" failed): the phone's frame is cross-origin in an opaque
  page (`Blocked a frame with origin "null" from accessing a cross-origin frame`), so `contentDocument` reads
  can't work. That's why the execution-context route is there.

## Not verified

- **The real claude.ai viewer frame.** I can't drive claude.ai's own frame from here. The answer above comes from
  the Artifact tool's documented contract, not from a test in the viewer.
- **iPhone Safari's `data:` tab** (B210's setup): not re-run on the phone. The sandboxed Chromium pass refuses
  IndexedDB the same way (a synchronous throw from `open()`, Chromium's `SecurityError`). The refusal check
  matches Safari's message as B210 quoted it ("invalid security context" contains "security"), whatever its error
  name is, but I didn't check this on a real Safari.
- **A refusal that comes later.** Blocked site data, where `open()` returns a request that fails later, still goes
  to the app as an error. The shell only switches on a synchronous throw or a missing or throwing
  `window.indexedDB`. I found no way to make headless Chromium refuse that way, so I left it out rather than ship
  an untested path.
- check.mjs is not in `tools/check.sh` (it needs Chromium); `test_shell_idb.py` is.
