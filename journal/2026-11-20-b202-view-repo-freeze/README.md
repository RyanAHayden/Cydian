# B202 Search > tweak from a repo not added > View Repo froze the app

## What it was

C26 (13:15) moved nav/actionsheet.js to motion.js's `EASE`, but `close()` still said `easing: ease`, which was
now undefined. From then on every action sheet's close threw a ReferenceError halfway through: the scrim had
`pointer-events: none` and the dim was fading out, but the sheet never slid away and `resolve()` (the last line)
never ran. So after View Repo the sheet stayed drawn, its buttons dead (taps went through), and `offerTweak` never
got an answer, so it never navigated. That reads as "the screen stays frozen, nothing responds". It hit every action
sheet, not only this one. View Repo was where the user saw it.

B201 (16:03, after the user's build) fixed the identifier. The report came in ~16:10 from a build made earlier.
The hypotheses in the brief were not the cause: there's no nav lock in this path, the sheet-close race doesn't hang,
and the repo page with `count: null` draws fine.

## Reproduced

`repro.mjs` (a copy of tools/smoke/smoke.mjs with the scenario swapped) runs the sideload app with a fake bridge in
headless Chromium: Search "dislike", tap the Keycap's Repo tweak under Other Sources · Canister, View Repo.
- On `48185b9b^` (before B201): the sheet stays on screen and the route stays `#/search`. Taps on the page do
  nothing, and the page logs `ReferenceError: ease is not defined at close (nav/actionsheet.js:60)`. Screenshot
  matched the report.
- On this branch: the repo page is pushed on the Search tab (`#/search/~sources/manage/find/keycap`), and its
  Tweaks sheet, Done, Back and the Sources tab all work. Also tried with CDP touch taps (`TOUCH=1`), and with the
  real api.canister.me (`REAL=1 Q=youtube`, tapping the ZodTTD archive, whose package list is 15 MB): no hang. The
  Tweaks count took 17 s to download, with two long tasks (66 and 98 ms) on desktop Chromium.

## Fix

- nav/actionsheet.js `close()`: answer first, then run the slide-out inside a try. A throw removes the sheet
  straight away. A timer (550 ms) removes it if the animation never ends, the same fallback nav/transition.js
  uses. A slip like C26's can no longer leave a dead sheet on screen or leave the caller waiting.
- Tests that would have caught it. findmore.test.js stubs the sheet, so the real one was never exercised:
  - nav/actionsheet.test.js: a choice answers its index and the sheet goes; Cancel answers -1 and a second tap
    does nothing; a slide-out that throws still answers and removes the sheet.
  - screens/viewrepo-search.test.js: Search's Other Sources · Canister row, the real action sheet, View Repo. It
    checks the sheet answers and goes, the link is `#/sources/manage/find/keycap`, and the router mounts it on the
    Search stack (`~sources`). The repo page then draws from the kept row (`count: null`, All Packages "—") and
    asks Canister only for the package list. Ran against the pre-B201 tree: all four tests fail with the
    ReferenceError.

## Tried that went nowhere

Before finding B201 I looked for an iOS-only cause. The Search flow worked in Chromium, with both mouse and touch.
I checked the push tap block (`html.nav-moving`, lifted in transition.js `animate`'s end, which has a timer
fallback), the selection ghost (F163 `lastPress`: the sheet's buttons aren't PRESSABLE, so they reset it),
slide.js's ResizeObserver, FocusKeyboard.swift and the native `net.fetch` path (async, replies on main), and the
size of Canister's package lists (BigBoss 8.9 MB, ZodTTD 15.7 MB: parse and filter cost under 0.2 s on desktop).
None of these froze anything.

## Not verified

- Not run on the user's iPhone19,2 / iOS 27 or any phone: the task doesn't name a device and AGENTS.md keeps the
  phones off limits unless it does. The cause is pinned by the Chromium repro on the old tree and the timeline (the
  user's build predates B201). A Lite build from main should confirm it by hand: Search, a tweak from an unadded
  repo, View Repo.
- The user's exact build number: "2541+" in the report. I assumed it was built between C26 (13:15) and B201 (16:03),
  since the freeze matches that window's bug exactly.
