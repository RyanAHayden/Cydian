# B77: Browse's Tweak/App of the Day card goes down under the finger

## What changed
- `web/app/app.js`: `a.browse-hero` joins `PRESSABLE`. Only the link (a loaded card) presses; the loading
  placeholder is a `div` and stays still. A finger on any child (name, icon, FREE button) finds the card through
  `closest`, so the whole card gets `.is-pressed`, with the same 140 ms quick-tap hold, the leave cancel and the
  scroll cancel (`pointercancel`) every pressable has.
- `web/app/packages.css`: `.browse-hero::after` is a flat `rgba(0,0,0,.3)` veil (absolute, inset 0, z-index 1,
  pointer-events none, opacity 0), shown by `.browse-hero.is-pressed::after`. The card's `overflow: hidden` clips
  it to the inner radius. No glow or highlight. The 1px card border stays as it is (it is already dark, and the
  veil sits inside the padding box).
- `web/app/browse-hero-press.test.js`: checks the PRESSABLE entry and the veil rule.
- `browse.js` was not touched: `heroCard` already makes the card an `<a>`.

## How it was checked
- `node --test web/app`: 1574 pass.
- A scratch page (scratchpad, not committed) imported the real `heroCard` and the CSS, and ran app.js's own press
  block (sliced from `const PRESSABLE` to the pointermove listener) against synthetic pointer events, in headless
  Chromium at 3x:
  - held vs idle: `held-vs-idle-3x.png` (top idle, bottom held). The whole card darkens: background, icon,
    words and the FREE button. Zoomed corners: the veil follows the radius, no light seam.
  - quick tap (pointerdown then pointerup on the description): `.is-pressed` still on right after up and at 60 ms,
    gone at 300 ms. A screenshot taken inside that window (virtual time) shows the held colour (28,79,28 vs idle
    41,114,41) at the card's middle.
  - pointerdown then pointercancel (what a scroll sends): not pressed afterwards.

## Not verified
- On a real phone (iPhone 7 / modern iPhone): the task asks only for the Chromium render and the task did not say to
  touch the 7, so a real finger, a real scroll-cancel from WebKit's pan, and how it feels were not checked there.
