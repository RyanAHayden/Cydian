# C11: one segmented control per style

## What changed

- `nav/ui.js` holds both controls now:
  - `segments(values, labels, current, onPick)`: the blue scope bar. The returned element also has `buttons`,
    `select(v)` (sets the selection without calling onPick; null selects none) and `show(values)` (hides the rest:
    Search's Jailbroken-only Tweaks/Themes). Search's Filter button stays a sibling in `.search-scope`, so
    `segments()` didn't need a trailing-button option.
  - `segmented(labels, { selected, onSelect })`: the grey UISegmentedControl (`ios6.css .store-segmented`), moved
    from storepage.js. storepage.js re-exports it so nothing that still imports it from there breaks during the
    merges.
- Search (`screens/search.js`) and Changes (`screens/changes.js`) use `segments()`. Changes' `state.segs` is now the
  control element, and `drawScope` calls `select()`.
- Depiction tabs (`depiction.js`), Reviews' This Build | App Store toggle (`reviews.js`) and Copying Files
  (`guides.js`) use `segmented()`. Settings imports it from `nav/ui.js`.
- I deleted `packages.css .segmented/.segment`. Depiction tabs keep their old 8px 12px margins
  (`.dep-tabs > .store-segmented`) so they line up with the depiction content. `.store-review-toggle` and
  `.guide-segmented` already set their own margins, and those still apply to the store control.
- I had to change `reviews.js`, which isn't in the brief's file list: the reviews.css toggle the brief names is
  built there.
- New test `web/app/nav/segments.test.js` checks `segments()` / `segmented()` behaviour. It also searches every
  non-test `.js` for a hand-built segment (`el("…", "…segment…")` or `className = "…segment…"`) outside
  `nav/ui.js`, and every `.css` for `.segmented`/`.segment`. I ran its pattern against the old depiction, changes
  and search code: it caught 6 hand-built segments.
- Updated guides.test.js and reviews.test.js for the class names (`store-segment`, `store-segmented`).

## What failed first

- The first gate run failed on installed.test.js (F147): my first `segments()` stored each value in
  `button.dataset`, and that test's fake DOM has no `dataset`. `select()` now matches by index into `values`, so
  it needs nothing from the DOM.

## Checks

- 3x Chromium render (`depiction-vs-store-3x.png`): the store page's control drawn by `segmented()` and a
  DepictionTabView drawn by `depiction.js renderSileo`, served over http from a scratch folder. They match: same
  edge, gradient and selected blue. The only difference is the depiction's 12px side margin.
- `node --test` passes for the touched screens' tests. The full gate is `tools/check.sh` (run by `done`).

## Not verified

- Dark theme and the sepia/solarized palettes on the depiction tabs and the guide/reviews toggles. They now use
  `.store-segment`, which already has dark and palette rules, so I didn't render them separately.
- No device check (iPhone 7 .deb or Safari). The task asked only for a desktop 3x render.
- Search's and Changes' scope bars after the move: no render. Their tests pass, and the DOM they build (classes,
  roles, aria-selected, hidden) is the same as before. One behaviour difference: tapping the segment that is
  already selected does nothing now. Before, Search re-ran the query and Changes redrew.
