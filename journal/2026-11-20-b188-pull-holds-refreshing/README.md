# B188: pull to refresh holds open while refreshing (Tweetie / iOS 6)

Before: letting go past the trigger ran the refresh but sprang the list straight back, and the text dropped to
"Pull down to refresh..." while the area was still on screen.

## What changed

- `web/app/nav/pullrefresh.js`
  - `pullTracker` has two more states: an armed release goes to `refreshing` (not `idle`), `done()` moves it to
    `closing` (the list slides back), `hidden()` moves it to `idle` once the area is behind the top bar. A gesture
    that starts while held is blocked and never changes the state (no arming, no second refresh).
  - `titleFor(state)`: "Refreshing..." in `refreshing` and `closing`, so the text only goes back to "Pull down to
    refresh..." after the area is hidden. Last Updated stays as it was.
  - `refreshEnd(result, { busy, onEnd })`: ends the hold once onRefresh's promise has settled (Changes, Sources)
    and `busy()` is false (the ifizbox:refreshing count, the reload bar, the page's own busy flag, e.g. Home's
    Reload button); checked on settle, on ifizbox:refreshing and every 250 ms; at least 600 ms (Home's busy flag
    only goes up once its click has run, and the spinner should be seen), at most 120 s.
  - The hold is a transform on the scroller's children (no padding/inset: that would be layout). Script path: the
    children slide from the pull to HOLD (60) with the spring's easing. Native path: iOS's bounce still runs after
    the lift; `bounceHold()` pushes the children down by whatever the bounce gives back under HOLD, so the list's
    top runs down to 60 and stops there with no jump (a gap left by the last scroll event slides in 150 ms). While
    held, the area rides with the list (HOLD - scrollTop) and a MutationObserver gives children a redraw adds the
    same transform. Closing slides children and area back; if the user has scrolled the area out of sight already,
    the transform is dropped and scrollTop reduced by the same amount in one go, so nothing moves.
  - Header comment rewritten for the new behaviour.
- `web/app/ios6.css`: `.pull-spinner` (the existing `--spinner-gray`, 20 pt, centred where the arrow was, turned
  by `hud-spin`; white on dark themes through the token), shown and the arrow hidden under `.pull-refresh.refreshing`.
  The arrow's turn back is `transition: transform 0s` while hidden (the block test only allows transform/opacity
  transitions).
- `pullrefresh.test.js`: states pull → armed → refreshing → closing → idle (hidden() ignored before done()), a
  pull while held, titles, bounceHold's numbers (list top = max(bounce, HOLD) all the way), refreshEnd with fake
  timers (waits for promise, busy and the minimum; rejected promise ends too; MAX cap; stop()), and the DOM wiring.

## Checks

- `node --test web/app/nav/*.test.js`: 172 pass.
- Chromium (headless, script path), `capture.mjs` (B161's copy) + `make_script.py`, app shell `--mode sideload`,
  Sources and Home: pull to 300 px, lift, refresh held running by hand (`ifizboxRefreshing = 1`). Probes printed
  per step: armed (arrow turned, "Release to refresh..."), then `refreshing` with children `translateY(60px)`, area
  foot at 0..60, spinner visible + `hud-spin`, arrow hidden, "Refreshing...", Last Updated kept; a second pull while
  held changed nothing; after the count went to 0 and the page's own refresh ended (reload bar gone, 0.9 s / 1.9 s),
  children back to no transform with "Refreshing..." still up while the area slides; then clip hidden and
  "Pull down to refresh...". `holds.png`: Sources armed / held / closing / reset, Home held / reset.
- iPhone 7 (native rubber band), under `ui-7.sh lock B188`: swapped only `nav/pullrefresh.js` (phone's copy was
  identical to main's) and the phone's own `ios6.css` plus the new rules (phone's ios6.css differed from main),
  backups kept, relaunched from the switcher. A real pull on Sources (`swipe 375 400 → 375 1100, 0.8 s`), 40 shots
  in a row: `iphone7.png` = right after the lift (held at 60 pt, spinner, "Refreshing...", Last Updated 1:25),
  still held while the refresh runs (Last Updated turned 1:26 when the count fell), mid-slide (still spinner and
  "Refreshing...", going behind the search bar), back at the top. List top measured in every shot: 357 px for 31
  shots, 308 mid-slide, 237 after: no snap. A slow pull afterwards showed the down arrow again. Files restored
  (md5 back to the originals) and the app closed from the switcher so it reloads them.

## Not verified

- The native release-to-hold slide itself (the ~340 ms bounce after the lift) was not caught between frames on the
  phone: the first shot after the lift was already at the hold. The list-top numbers show no jump afterwards; there
  was no screen recording tool for the 7.
- Changes' pull on a phone (its refresh is under a HUD, ends through its promise): covered by refreshEnd's test and
  the Chromium Sources/Home runs only.
- Home on the website: its Reload re-downloads the site and reloads the page, so the hold ends with the reload;
  shot only in the app shell.
- On Home with the "iFizBox X is out." notification banner up, the banner (an overlay) covers the held area; that is
  the banner's overlay, the same as before for any pull.
- A redraw that replaces the scroller element itself (not its children) mid-hold leaves the new page without the
  hold: the old one finishes on the detached element. Not seen in the runs.
