# C21: retire the hand-rolled FLIP code

## What changed

- `web/app/screens/installroute.js`: deleted `slideLayout` and `slideBelow` (the F300/B167 FLIP code that measured
  groups' tops and the box's height and animated them and everything below by hand). `patchGroups` now runs its DOM
  change through `slideChange(box, change)` from `nav/slide.js`, which measures the page's slide root right before
  and after the change and slides, fades in and fades out what moved. The `nav/motion.js` import went with them.
- `web/app/nav/ui.js`: `collapse(li)` lost its fallback (measure the row, move everything below it one row down and
  ease it up). It is now `slideChange(li, () => li.remove())`: the watcher slides the rows below up and fades the
  row out. The `isWatched` and motion imports went.
- `web/app/nav/slide.js`: only its header comment (isWatched no longer serves collapse). `isWatched` stays
  exported: `slide.test.js` uses it.
- `docs/settings.md`: Installation's "groups slide" note names the watcher instead of `slideLayout`.

Why `slideChange` and not a bare change: the MutationObserver would slide it too, but one tick later, after a
layout the change's own code may already have read; slideChange measures right around it, and is a plain
`change()` where no watcher is installed (node tests, a page not in a slide root), so nothing breaks there; it just
doesn't animate, as the old fallback's targets never were outside a page body anyway.

## Checks

- `node --test` in web/app: 2467 pass, 0 fail.
- `tools/check.sh`: passed (native .deb built too, 0.17.0-2702).
- Chromium (headless, real modules, a scratch page with `installSlides()` and a `.page-body`): a `patchGroups`
  repaint that adds a row to the first group kept the second group's element and started slides on it and on what's
  under the box, and faded the new row in; `collapse(li)` faded a copy of the row out and slid the rows below up.
  The page lived in the scratchpad only, not committed.

## iPhone 7

Installed this branch's .deb (0.17.0-2702) on the 7. It hung on "Loading" for ever, and still did with my two JS files
put back to main's: main's own build is broken on iOS 15. Cause: `core/tweaks.js` `LIBRARY_DESC` (B185, landed today)
uses a regex lookbehind `(?<!…)`, a SyntaxError in WebKit before Safari 16.4, so every module importing tweaks.js
fails. Filed **B193** (critical). With the lookbehind removed from the phone's copy of tweaks.js only, the app loads.
**The phone is left on this branch's .deb with that one-line tweaks.js patch** (so it works for the next task; the
original is at `/tmp/tweaks.orig.js` on the phone). The next .deb install replaces it.

Installation & Signing exists only in the sideload build (settings.js F271 `merged`, `installRoute`), so the
jailbreak app on the 7 has no Installation page to watch: Settings shows Account, General, Theme, Updates, Install
IPA, Console, About.

## Not verified

- Installation's rows sliding on a phone: the page is sideload-only and the 7 runs the jailbreak build; no sideload
  IPA test on a phone in this task. Covered instead by the Chromium check above.
- `collapse()` on the 7 (removing a source on Sources, the only jailbreak-build caller): not tried, since it removes
  a real source from the shared test phone; the Chromium check covers the code path, and it is the same watcher every
  page already uses on the phone since F299.
