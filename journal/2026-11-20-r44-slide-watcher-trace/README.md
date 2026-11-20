# R44 Trace the FLIP size watcher on the iPhone 7

## Question

`web/app/nav/slide.js` re-measures every block box of a slide root (up to `MAX_BOXES` = 600) after each
MutationObserver batch, and its observer watched `characterData` and text-only `childList` changes too. So a
ticking label (a count, a percentage, a timer) costs a full measure of its page every tick. Does that drop frames on
the iPhone 7?

## What I did

- A harness (`harness/`): a page in the app's own origin with the app's `style.css` + `ios6.css`, rows built like
  `nav/ui.js` `grouped()`, three variants and four scenarios, one run per page load, results kept in localStorage and
  drawn as a table at the end.
  - variants: `base` (no watcher), `a` (slide.js as on main, `harness/slide-a.js`), `b` (the change below,
    `harness/slide-b.js`, the same as `web/app/nav/slide.js` on this branch);
  - scenarios: `tick40` / `tick500` (a `.cell-detail`'s `textContent` set every frame on a 40- / 500-row page),
    `cd500` (the same through a text node's `.data`, i.e. `characterData` records), `wrap40` (a group footer toggles
    between one and three lines every 400 ms on a page of 10 groups: the groups under it must still slide);
  - measured: rAF frame intervals, time inside the (wrapped) MutationObserver/ResizeObserver callbacks,
    `getComputedStyle` calls (one per measured box), `Element.animate` calls.
- Dry run in headless Chromium first (`harness/chromium.mjs`; results `chromium-results.json`).
- On the iPhone 7 under the `ui-7.sh` lock: backed up the app's `web/index.html`, installed the harness as
  `index.html` plus `web/r44/*.js`, closed the app from the switcher, opened `ifizbox://home`, waited for the table,
  screenshotted it (`iphone7-results.txt` has it transcribed), then put the original `index.html` back (md5
  `17b2e7c2…` checked), removed `web/r44/` and `/tmp/r44*`, relaunched (Home drew normally), unlocked.

## Findings (iPhone 7, iOS 15.8.8; two runs each, they agree)

The iPhone 7's panel is 60 Hz (the brief's "120 Hz" is the docs/native.md target for ProMotion phones), so a frame
budget here is 16.7 ms; anything that eats a few ms on the 7 eats proportionally more of an 8.3 ms frame at 120 Hz.

| scenario | fps base / a / b | frames > 25 ms base / a / b | watcher ms per callback a → b | boxes measured per tick a → b |
|---|---|---|---|---|
| tick40 (label ticks, 40 rows) | 59.9 / 59.3 / 59.4 | 0 / 1 / 1 | 3.5 → 0.25 | 208 → 3 |
| tick500 (label ticks, 500 rows) | 44.2 / **39.1** / 44.0 | 4 / **26** / 4 | 4.8 → 0.1 | 601 → 0 |
| cd500 (characterData, 500 rows) | 44.1 / **39.1** / 44.0 | 4 / **31** / 5 | 4.8 → 0.03 | 601 → 0 |
| wrap40 (footer wraps, slides) | 60.1 / 58.1 / 58.3 | 8 / 14 / 13 | 11 → 7 | 19 → 9 |

(From `iphone7-results.txt`, run 0; run 1 is within a few percent.)

- **Frames did drop**: on a 500-row page a ticking label took the watcher ~4.8 ms a tick (it walks 600 boxes, then
  gives up because the page is over `MAX_BOXES`, and does it again next tick), which pushed the page from 44 to 39 fps
  and p50 from 22 to 25 ms, with 22-31 long frames per 4 s instead of 4-5.
- On a normal 40-row page nothing dropped at 60 Hz, but the watcher spent 835 ms of every 4 s (≈ 3.5 ms a frame,
  a fifth of a 60 Hz frame and over 40 % of a 120 Hz one) re-measuring 208 boxes for a label that never moved
  anything.
- The 500-row page is slow even with no watcher (44 fps): WebKit re-lays out the whole non-virtualised list on each
  text change. That is the page's cost, not the watcher's; long lists belong in `.vlist` (docs/native.md).
- Chromium on the desktop shows the same shape with ~10x smaller numbers (a: 2 ms a tick at 600 boxes, b: ~0), no
  frames dropped there.

## The change (`web/app/nav/slide.js`)

The MutationObserver now skips text-only records: `characterData`, and `childList` records whose added and removed
nodes are all text nodes (what `el.textContent = "…"` on a text-only element produces). A text change adds or removes
no box, so nothing can move unless a box changes size, and every measured box is already under the ResizeObserver,
which reports exactly that and runs the same `update()`. Without a ResizeObserver (`ro` null) text records still
re-measure as before.

After: `b` matches `base` on every tick scenario (44.0 vs 44.2 fps at 500 rows, watcher 0.03-0.25 ms a callback),
and `wrap40` still starts all 36 slides/fades, the same as `a`, with about half the boxes measured (the
ResizeObserver report alone triggers one measure; before, the MutationObserver and the ResizeObserver each did).

## Tried, not kept

- First `wrap40` toggled a row's label: `.cell-label` doesn't wrap (single line, ellipsis), so nothing changed size
  and neither variant slid anything; a test that proved nothing. Switched to a group footer, which wraps.
- Waiting for the phone run by polling its WebKit localStorage over ssh: the phone has no `sqlite3`. Screenshotted the
  table instead.

## Not done (on purpose)

- A cheap bail-out for roots over `MAX_BOXES` (remember "over" and skip the walk until the root's children change):
  with text changes skipped, the remaining cost on such a page comes only from real DOM changes, where a 600-box walk
  per batch is the documented trade-off. Not measured as a problem.
- No unit test for the text-only filter: the brief's files are slide.js and the journal, and `slide.test.js` tests only
  the pure functions (pairUp/plan/measure). The on-device `wrap40` run is the check that slides still happen.

## Not verified

- **120 Hz**: the iPhone 7 is 60 Hz; no ProMotion phone with the jailbreak build is available to agents. The per-tick
  watcher cost (3.5 ms before, 0.25 ms after on a 40-row page, on an A10) is the number that carries over.
- **Real screens**: the harness builds its own rows with the app's stylesheets, not the app's screens (no queue
  running, so no real ticking label to watch). Real tickers (`alert.js` countdown, `signing.js` UDID poll,
  `installroute.js` poll) all set `textContent`, the case measured.
- **Edge case**: a text change that changes a box's height in the same frame the box is first observed is now
  missed (the ResizeObserver's first report is skipped by design). Before, the MutationObserver would have slid it.
  Such a box is new anyway (it fades in), so no visible difference is expected; not tested on a phone.
- The app's localStorage on the 7 still holds an `r44.results` key from the run (no way to clear it from ssh without
  sqlite3 on the phone); nothing reads it.
