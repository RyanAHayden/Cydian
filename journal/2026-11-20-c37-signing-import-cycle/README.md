# C37: break the import cycle inside web/app/signing/

The 10-module strongly connected component (browser, device, early, identity, install, password, prompt, queue,
route, watch) was held together by a handful of back edges, each for a few small helpers. Those helpers moved to
`signing/common.js` (already "Signing's shared helpers", imported by all of them, importing none of them), and the
old module re-exports them, so signing-client.js, screens and tests import as before:

- `signFail`, `runInWorker`, `retrying` (were browser.js; early.js, prompt.js, password.js needed them).
  `runInWorker`'s `new URL("../signing-worker.js", import.meta.url)` resolves the same from common.js (same folder).
- `isSelfIpa` (was install.js; early.js, route.js, browser.js needed it).
- `defaultServer`, `getServer`, `setServer` (were identity.js; device.js needed `getServer`).
- `hereLabel`, `shownName`, `finishHere` (were queue.js; route.js needed them, and queue imports route).

Two edges went lazy instead (dynamic `import()`, which the cycle test ignores and can't deadlock a load):

- browser.js -> install.js: only No Certificate's remembered retry calls `signAndInstall`; now it imports install.js
  when that retry runs (the surrounding code already lazily imports screens/signing.js).
- password.js -> identity.js: `confirmPassword`/`identityCert` default to identity's load/save through small local
  wrappers that import identity.js on call. identity.js keeps its static import of password.js (saveIdentity calls
  `confirmSoon`), so password.js still loads with identity and its load-time warm-up still runs.

Dropped the line from KNOWN in web/app/import-cycles.test.js.

## Tried and dropped

First version put the helpers in four new leaf modules (worker.js, selfipa.js, server.js, here.js). The gate failed
on module-graph.test.js: app.js's startup closure went to 126 modules, over its bound of 124. Folding them into
common.js adds no module, so the bound stays as it is.

## Checks

`node --test` on import-cycles, module-graph, signing-client*, incoming-ipa-signing, signing-sheet: 120 pass.
Full gate via `run done`.

## Not verified

- The website's sign flow in a real browser (the Web Worker URL from common.js, the No Certificate retry's lazy
  import, the password warm-up): no browser session with a certificate here; covered only by the node tests.
- The phone apps: no device run; the moved code is the same text, only its module changed.
