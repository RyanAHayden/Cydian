# F166: spinners turn in the app, drawn like iOS 6's (2026-11-18)

F166 as written, plus F167 (redraw the spinners from the 4S's UIKit art), which the user merged into it on main
(486d623) while this task was running.

## Cause: steps() on iOS 15 WebKit, not the app shell

A probe injected into the installed app's `index.html` (iPhone 7, iOS 15.8.8, Cydian 0.4.0-881) put five 30 px
squares on screen, each with `@keyframes hud-spin { to { transform: rotate(360deg) } }`:

1. `.96s steps(12) infinite`: **stands still**
2. `.96s linear infinite`: turns
3. `steps(12)` with `will-change: transform`: **stands still**
4. hold keyframes (below) with `linear`: turns, 30 degrees at a time
5. `steps(12, end)` with `position: relative`: **stands still**

`getAnimations()` reported every one as `running` with `currentTime` advancing, rAF ran at ~58 fps,
`prefers-reduced-motion` was false and no `html.native` rule touches `animation`. The same page served to **Safari on
the same phone** (reverse tunnel, docs/iphone7.md N11) shows the same thing. So it isn't the native shell (not
`PreferPageRenderingUpdatesNear60FPSEnabled`, not rAF, not Reduce Motion, not the element being replaced). It's iOS 15
WebKit: the animation runs, but the transform with a `steps()` timing function never reaches the screen once it's
handed to Core Animation. The website "works" only on the browsers it was checked on (desktop, newer iOS).
`probe-app-vs-safari.png`: left, three app frames; right, four Safari frames; columns in the order above.

Candidates from the brief, checked: native shell pausing animations or rAF (no: rAF runs, linear runs), `html.native`
override (none; now covered by a test), element replaced every frame (no: `currentTime` keeps going up), steps(12) on
a composited layer (**yes**, and on any layer: plain or will-change), Reduce Motion (off).

## Fix

- `ios6.css` `@keyframes hud-spin` now holds each 30-degree turn for 1/12 of the cycle (`0%, 8.332% { rotate(0) }
  8.333%, 16.666% { rotate(30deg) } ...`) and every spinner runs it with `linear` timing: 12 steps per 0.96 s with
  no steps() anywhere. The 0.001 % ramps between holds last about 10 µs.
- The spinners are now one image per UIKit style, `--spinner-white`, `--spinner-gray`, `--spinner-large` in
  `ios6.css`, drawn by `web/app/nav/spinner.js` (the test keeps the CSS data URLs equal to `spinnerURL()`):
  - white (UIActivityIndicatorViewStyleWhite, 20 pt): Home's reloading nav button, the reload bar, the tab badge
    (at 16 px inside the badge's 2 px ring)
  - gray (...StyleGray, 20 pt): `.loading-spinner`, a loading source row. On the dark theme lists take the white
    one, since black at 38 % disappears there (iOS 6 has no dark theme to copy).
  - large (...StyleWhiteLarge, 37 pt): the HUD (36 -> 37 px)
- `nav/hud.js` and `nav/reloadbar.js` draw a `<span>` with that background instead of building their own SVG
  spokes.

## Measurements (ref/4s/artwork/Shared@2x, frame 0 of each style)

- Every frame N is frame 0 turned 30*N degrees clockwise (mean alpha difference 0.003 at N=3, about 1-2.4 at N=1 from
  resampling), so one image turned a spoke at a time is the whole animation.
- 12 spokes, round caps, flat colour (white, or black for Gray). The brightest at 9 o'clock, five dimmer ones behind it
  (8 o'clock round to 4), the other six at the floor.
- Alphas (of 255) from 12 o'clock clockwise: White and WhiteLarge `69 69 69 69 94 118 143 168 192 217 69 69`; Gray
  `31 31 31 31 42 53 64 75 86 98 31 31`.
- White and Gray: a 20 pt box, spokes 2 pt wide, reaching from r 5 to r 10 pt (centre line r 6-9). WhiteLarge: a
  37 pt box, spokes 3 pt wide, from r 8.5 to r 17.5 (centre line r 10-16). The first try had r 10.5 for the large
  one, which put its inner end 1 px (@2x) short; `tools/spinnercmp.py` showed edge differences of up to 149 levels
  until I changed it to 10.
- `tools/spinnercmp.py` (local, Pillow + rsvg-convert) renders ours at @2x and compares: white mean 0.11, max 2
  levels; gray mean 0.12, max 2; large mean 0.12, 99th percentile 3, max 5 (anti-aliasing at the caps). Mid-spoke
  alphas are identical for all 12 spokes of all three. `compare-4x.png`: each style, 4S left and ours right, every
  @2x pixel drawn 4x4.

## On the phone

The `.deb` from this branch (0.4.0-946) on the iPhone 7, with an overlay (injected for the screenshots and then
removed) holding the app's own `.hud-spinner`, `.reload-spinner`, `.loading-spinner`, `.badge.spinning` and
`.bar-button.is-reloading`: `iphone7-three-frames.png`, three screenshots about 0.5 s apart, with the bright spoke in a
different place in each.

What went wrong on the way: my first CSS edit put the keyframes' closing brace after `:root {`, so the custom
properties were never defined and every spinner was invisible on the phone (and in Chromium). The test didn't catch
it, because its keyframes regex stopped at the stray brace. The test now reads the variables from the parsed `:root`
rule and fails if the keyframes block swallows anything. I checked that it fails on the broken file.

## Tests

`web/app/nav/spinner.test.js` (in `node --test web/app`): every `hud-spin` user runs `.96s linear infinite` and none uses
steps(); the keyframes are 12 holds of 30 degrees; no rule with `native` in its selector stops (`none`, `paused`,
`animation-play-state`), or touches the animation, transform or display of a spinner, and no reduced-motion rule stops
one; `:root` holds spinner.js's three images and every spinner draws one; the geometry and alphas are as measured.
Mutation check: putting back `steps(12)` and adding `html.native .loading-spinner { animation: none }` fails two
tests.

## Follow-up filed

R18 (low): `progress.css`'s blinking cursor uses `steps(1, end)` on opacity and may stand still on iOS 15 for the
same reason. I didn't check it, because it's outside this task.

## Not verified

- **The sideload IPA on a phone.** It builds (`native/build.sh all`, 0.4.0-946) and carries the new `ios6.css`, but I
  had no non-jailbroken phone to install it on. It's the same `web/app/` in the same WKWebView, so the same fix
  applies.
- **The spinners in their real places during a real reload.** On the iPhone 7 a source refresh ends in under a
  second, faster than `phonectl shot` (about 1 s each) can follow, so the screenshots show the app's spinner classes in
  an injected overlay, not in the reload bar, the HUD and the tab bar themselves.
- **Which UIKit style Cydia's tab badge uses.** Cydia's source host (git.saurik.com) answered 503 and there's no 4S
  screenshot of the badge spinning. Following the brief ("white in bars and badges"), I used the 20 pt White style at
  16 px. UIKit also has 14 pt small styles (WhiteSmall, GraySmall, WhiteSmallShadowed: 8 spokes, 16 frames that
  cross-fade, so not a plain rotation, and the Gray/Shadowed ones have an emboss). If the badge really used
  WhiteSmall, it needs that 16-frame animation instead.
- **"Shaded" spokes.** The user saw iOS 6's spokes as shaded. The 20 pt and 37 pt UIKit frames are flat colour with
  rounded caps (checked pixel by pixel), and I drew them that way. Only the 14 pt GraySmall and WhiteSmallShadowed
  frames carry an emboss.
- Safari Web Inspector over USB wasn't needed (the on-screen probe answered the question) and wasn't tried.
