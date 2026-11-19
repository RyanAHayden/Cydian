# F218: Confirm's Cancel is the red bar button

## Read this first: Cydia's Confirm Cancel is *not* red on the 4S

The brief says "as Cydia's Confirm sheet". The 4S's own screenshot of Cydia's Confirm sheet
(`ref/4s/screens/queue-81.png`, taken for F80/F81) shows Cancel in the **default** blue-grey bar button: at x=70 the
button reads #94a6bf → #43638e, the same as UINavigationBarDefaultButton (#99aac2 → #41618e), and the
right-hand image of `ref/4s/screens/f218-compare.png` shows it. queue-83 shows the same.
The user asked for a red Cancel in plain words, and the change is small and easy to undo, so I did it anyway.
To go back to Cydia's look, remove `"red"` from `confirmCancel()` in `web/app/screens/queue.js` (the CSS can stay).

## What I did

- **Art.** UIKit has a red bar button: `UINavigationBarRemoveButton` (+`Pressed`, `Dark`, `PressedDark`) in
  `ref/4s/artwork/Shared@2x/`, the same 22×60 shape as UINavigationBarDefaultButton. I sampled the centre column:
  - light: top edge #482e30, gradient #d4848b (row 3) → #b01a27 (row 55), bottom edge #82131c;
    pressed #3d3031 / #b28b8e → #70272d / #521c20.
  - Dark (the black-bar art, used for dark mode like `--dk-btn`): a gloss #d07079 → #b82e3a over rows 3–29, then
    flat #b01825 from row 30 (30/58 = 51.7% of the border box); edges #251516 / #610d14; pressed #9f7478 → #76373b,
    flat #6f252b, edges #1d1516 / #3d1418.
  So I didn't need a screenshot of the button on the 4S, and it doesn't have a red one to shoot anyway (see above).
- **`web/app/ios6.css`** (one new block after the back arrow): `--lt-red*` tokens on `:root`, `--dk-red*` on
  `html[data-theme="dark"]` (OLED Black; Gunmetal, Midnight and Linen inherit them), and `.bar-button.red` rest/pressed
  rules, light and dark. They only change colours: shape, inset highlight and bottom shadow come from `.bar-button`
  as they are, with `background-origin: border-box` after every `background:` and no new highlights. Each rule
  carries `:not(.back):not(.done)` so it beats the dark rule `html[data-theme=dark] .bar-button:not(.back):not(.done)`
  ((0,5,1) over (0,4,1); pressed (0,6,1) over (0,5,1)).
- **`web/app/palettes.css`** (a new block at the end): Nord (#bf616a), Dracula (#d94848, Dracula's #ff5555 at 85%
  so white text stays readable) and Solarized Light (#c62d2a, #dc322f at 90%) each get their own red, in the art's
  steps (light: top 46% toward white, edge 74%; dark: gloss 39%/6% toward white, edge 55%; these steps give back
  UIKit's own values to within 2 levels when fed #b01a27/#b01825). The others keep UIKit's red, the same way they
  keep the kit's blue Done. Sepia and Solarized need their own red rule: their `.bar-button:not(.back):not(.done)`
  rule is (0,5,1), and the red one there is (0,6,1).
- **`web/app/screens/queue.js`**: `export function confirmCancel()` = `barButton("Cancel", "red")`, used by both
  Confirm sheets: `openConfirm` (packages, as the brief says) and `openAppConfirm` (apps). They are the same sheet
  (title "Confirm", Cancel clears the queue), so having them differ would look wrong. No other Cancel changed:
  sharedeb.js and nav/progress.js still use the plain button.
- **Test** `web/app/screens/queue-confirm.test.js`: confirmCancel's class; `openAppConfirm` driven with a fake DOM
  (its left button is the red Cancel, its right button is still Done, and Cancel clears the queue); both Confirm
  functions build `cancel` with `confirmCancel()` (a source check, since `openConfirm` isn't exported and needs apt);
  no other screen or nav module makes a red bar button; ios6.css has all four rules with border-box gradients and
  the art's values; palettes.css has the light-palette rule.

## Renders (3x, headless Chromium, the app's real stylesheets)

`tools/bar.html` is the Confirm nav bar (Cancel red, Confirm Done; second row pressed, beside a plain Edit).
`sh journal/2026-11-18-f218-red-confirm-cancel/tools/shots.sh` from the repo root writes:
`light.png`, `dark.png` (OLED Black), `dark-gunmetal.png`, `dark-nord.png`, `dark-dracula.png`, `light-sepia.png`,
`light-solarized.png`.

Next to the 4S: `ref/4s/screens/f218-compare.png` (gitignored, because it holds UIKit pixels; AGENTS.md says
no Apple art in git). Left to right, at 6x: our light Cancel, UINavigationBarRemoveButton three-sliced to the same
width at 3x, our dark Cancel, UINavigationBarRemoveButtonDark, and Cydia's real Confirm Cancel from queue-81.png.
Same shape, same edges, same gloss split. Sampled down the button at x=25 of the 3x render (top edge → bottom edge):

| where | art light | ours light | art Dark | ours dark |
|---|---|---|---|---|
| top edge | #482e30 | #482e30 | #251516 | #251516 |
| 10% | #d17f86 | #d07980 | #ce6a73 | #cb626c |
| 30% | #c5656d | #c9636c | #c34b56 | #c24954 |
| 50% | #b94852 | #c24f59 | #b9303c | #b9313c |
| 80% | #b02430 | #b8303b | #b01825 | #b01825 |
| 95% | #b01b28 | #b21f2c | #b01825 | #b01825 |
| bottom edge | #82131c | #82131c | #610d14 | #610d14 |

In light mode the middle runs a few levels lighter than the
art, because UIKit's gradient isn't quite linear. `.bar-button` simplifies its blue the same way (two stops), so I
kept it the same here. The pressed rows match just as closely (e.g. light 30% #9c6d71 art / #9e6c70 ours).

## Tried / didn't work

- The first sampling pass read the middle rows off the "Cancel" lettering (x+60): I sampled again at x=25.
- I first put the red tokens in blocks of their own (a second `:root` and dark block in ios6.css, extra palette
  blocks at the end of palettes.css). The gate failed: `palettes.test.js` and `theme-palette.test.js` read only
  the *first* `:root`, OLED Black and palette blocks, and they require every light palette to set each `--lt-*`
  the chrome rules read. I moved the tokens to the end of those main blocks and gave Sepia UIKit's red explicitly.
  The renders came out pixel-identical before and after.

## Not verified

- **No new 4S screenshot.** I didn't take the ui-4s.sh lock or queue a package in Cydia: the 4S shot of exactly that
  sheet already exists (queue-81.png, 640×960, the 4S takes 2x shots, not 3x), and it shows Cydia's Cancel is not red,
  so there was no red button to sample. The red values come from UIKit's own art instead.
- **The package Confirm sheet (`openConfirm`) wasn't opened in a test.** It isn't exported and needs the apt
  backend and installQueue; the test checks its source uses `confirmCancel()`, and the app sheet, built the same
  way, is checked for real.
- **Not seen on a phone** (iPhone 7 / Safari): the task doesn't ask for it; the renders are headless Chromium.
- **Midnight and Linen** (dark) and the remaining light palettes inherit UIKit's red. Only Gunmetal, Nord, Dracula,
  Sepia and Solarized were rendered.
