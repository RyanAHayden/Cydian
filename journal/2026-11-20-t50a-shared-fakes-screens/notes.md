# T50a: shared test fakes, screens/ pass

## What I did

- Grew the shared `fakeNode` in `web/app/nav/fakedom.test-helper.js` into a superset of the screens/ copies:
  uppercase `tagName` (as the real DOM; `#text`/`#fragment` kept), `_cls` (the class Set, which many tests read),
  `listeners` with `addEventListener`/`removeEventListener`, `fire`/`dispatch`/`click` (resolve when async listeners
  end; the event carries `type`, `target`, `currentTarget`, `preventDefault`, `stopPropagation`,
  `stopImmediatePropagation`), `hidden`/`disabled`/`type`/`value`, `insertBefore`/`appendChild`/`removeChild`/
  `remove`/`before`/`after`/`replaceWith`, `firstChild`/`lastChild`/`firstElementChild`, `closest`, an `innerHTML`
  setter that clears, `animate`/`focus`/`blur`/pointer-capture no-ops, and `style.setProperty`/`removeProperty`
  (non-enumerable, writable so a test can spy on them). Appending a node now takes it out of its old parent.
- Selectors: `.a.b`, a tag, `:scope > .a`, comma lists, as the real DOM reads them. The first copy of the shared DOM
  read every selector as a class, so findmore.test.js's `querySelector("find-row")` etc. now say `.find-row`.
- `fakeDocument()` now has a connected `body`, `createElementNS`, `createTextNode`, document listeners,
  `querySelector(All)` over the body and a `documentElement` (websitelock's copy had one).
- The local `tick` copies in altstore-gallery and tweaks-app now import the shared one.
- Moved 17 screens/ test files off their own `fakeDom()` copy onto `fakeDocument` from `fakes.test-helper.js`:
  apprun, apprun-b153, apprun-b170, apprun-self, jbappqueue, queuerun, queue-confirm, reviews (and its `tick`),
  reviews-rating, myipas-page, notiphone, homelock, websitelock, handoff-managers, guides, storepage, handoff.
  Where a file imported it as `fakeDom`, the rest of the file is unchanged.

## Check

`node --test --test-reporter=tap web/app` on main and after: 2545 tests, 2545 pass both times, and the sorted
`ok` names diff empty.

## Tried / failed

- First run: findmore.test.js failed because the new matcher read `find-row` as a tag. A tag-or-class rule made it
  pass, but the spec review flagged it as hiding selector mistakes; fixed the test's selectors instead.
- Review also flagged an unused `withDocument` helper and stubs no copy had (`getBoundingClientRect`,
  `releasePointerCapture`, `hasAttribute`): removed.
- Accepted on purpose: handoff-managers' old fake had a dead `classList` (contains always false) and guides/myipas
  appended strings to `_text`; the shared node has a real classList and `#text` children. textContent reads the
  same, and every test still passes with the same names.
- myipas-page.test.js assigns `style.setProperty`; the first non-enumerable stub was read-only. Made it writable.

## Left for later

The other screens/ fakes have different shapes (`fakeEl`/`fakeElement` built per test, the progress-page
`fakePage()` stand-ins in apprun*/queuerun/jbappqueue, which are nav/progress.js fakes and not a page body, local
Filed as follow-up T50c rather than forced here.

## Not verified

none (the gate `tools/check.sh` is run by `done`).
