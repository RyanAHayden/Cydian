# T50c: shared test fakes, screens/ second pass

## What I did

Moved the screens/ tests that built their own per-test fake DOM onto the shared one (`fakes.test-helper.js`,
which re-exports `nav/fakedom.test-helper.js`): altstore-gallery, altstore-marktoggle, depiction, description,
featuredstrip-b182, extras, resignqueue, homefeatured, tweaks-addpage, tweaks-app, why, settings,
myipas-signoptions-layout, installed-manage, custominstall, rootcopies and the seven installroute-* files
(busy, check, f300, f301, leave, pair, signin-leave; installroute.test.js had none).

The shared helper grew:

- `withDocument(fn, doc = fakeDocument())`: runs `fn(doc)` with `doc` as `globalThis.document` and puts the old one
  back (or deletes it when there was none). Synchronous for a plain return, after settling for a promise, so the
  tests that used a sync `withDom` still read results straight away. Exported from `fakes.test-helper.js`.
- Selectors: `[attr]` / `[attr="v"]` (data-* from dataset) and descendant / `>` chains, ported from rootcopies'
  own copy, which needed them. `.a.b`, tags, `:scope > .a` and comma lists read as before.
- Nodes: `nodeType`, `parentElement`, `childElementCount`, `lastElementChild`, `nextSibling`,
  `nextElementSibling`, `previousElementSibling`, `hasAttribute`, a synchronous `dispatchEvent`, `classList.replace`.

What stays per test, as a thin wrapper around the shared element (test-specific layout, not DOM behaviour):
altstore-gallery's class-based `offsetHeight`, tweaks-app's `all(cls)` lookup, rootcopies' layout numbers
(`getBoundingClientRect`, `clientHeight`, ...) and its plain-markup `innerHTML` parser for nav/pullrefresh.js.

Test-side reads changed where the old fakes differed from the DOM:

- depiction, extras, resignqueue, settings: their `text`/`texts` helpers read `textContent` per node, which in
  the old fakes held only the node's own text. They read `_text` now (the shared node's own text) so the lists are
  the same as before; depiction's "no duplicate text beside the view" check reads `history._text` for the same reason.
- settings: the F205 "rich" document (querySelector for one class) is gone: the shared one does that. Dropped a
  comment saying the fake classList cannot toggle "selected" (it can now).
- installed-manage: the page bodies are appended to the fake document's body (the old fake said `isConnected: true`
  for every element).

Left as the brief says: the nav/progress.js `fakePage` stand-ins in apprun*/queuerun/jbappqueue. Not in the
list and left alone: queue-rootpage, queue-chrome (their own `make`).

## Check

`node --test --test-reporter=tap web/app` before the change (this branch at its start, which is main's tree) and
after: 2555 tests, 2555 pass both times, and the sorted `ok` names diff empty.

## Tried / failed

- Nothing failed outright. Old fakes with no-op `querySelector`/`closest`/`remove` (resignqueue, settings) now run
  the real ones; every test still passed with the same names.
- I wrote the first `withDocument` addition with a heredoc append and one file's block removal with a short python
  edit before switching to the file-edit tool for the rest; both results were read back and tested.

## Not verified

none (the gate `tools/check.sh` runs in `done`).
