# F341: iOS 7 action sheet and alert geometry

F333 restyled the iOS 7 action sheet and alert but had no hooks for their geometry, so the sheet still showed separate
rounded buttons with the title floating above them, and the alert kept iOS 6's 340px box, padding and button gaps
(F333 drew its lines on the box, measured up from its bottom). This task adds the hooks and sets the kit's values.

## Kit measurements (`ref/teehanlax/ios7/sheet.svg`, 2x halved)

- "Actions Sheet": buttons 815..1423 on a 640 screen (8pt from each side), each 44pt, one 1px (.5pt) gap between
  them; the first and last corners 3pt (6px radius); Cancel 44pt, 8pt under the block and 8pt over the screen's
  bottom. In `original-2x.png` the gap is the dimmed page behind it (#252525 there): the kit draws no line.
- "Alert": a 540px (270pt) box, 7pt corners; the "break lines" bitmap is 89px high at the box's bottom: a 1px
  rgba(0,0,0,.3) line, then the 44pt button row, a 1px line down its middle. Title baselines put the first line about
  18pt under the box's top and the line about 18pt under the last text.

## What changed

- `style.css`, Era hooks: a new `:root` block with iOS 6's values: `--action-sheet-pad`, `--action-sheet-pad-bottom`,
  `--action-gap`, `--action-list-gap`, `--action-list-bleed`, `--action-title-margin`, `--action-title-pad`,
  `--action-cancel-gap`, `--alert-w`, `--alert-pad`, `--alert-buttons-margin`, `--alert-buttons-gap`,
  `--alert-stacked-gap`, `--alert-button-h`.
- `packages.css` (the sheet) and `sources.css` (the alert) read them in their layout rules. `margin-top: 4px` on the
  alert's button row became `margin: var(--alert-buttons-margin)` (4px 0 0), the same box.
- `ios7.css`: sheet 8pt sides and bottom, 8pt gap, choices touching in one block with 3pt corners (on the list, which
  clips), the title as the block's first cell (the list's colour, 14/16pt padding, its bottom margin closing the 8pt
  gap), Cancel with no extra gap. Alert 270px, padding 18px 16px 0, the row's margin `8px -16px 0` (edge to edge),
  no gaps, 44px buttons. F333's box-drawn lines (five `:has()` rules counting stacked buttons) are gone: each button
  draws `inset 0 .5px 0` along its top, and the second of a side-by-side pair also `inset .5px 0 0` down its left;
  the bottom buttons take the box's 7pt corners so a press stays inside.
- `docs/eras.md`: the hooks in the Geometry table.
- `ios6-css.test.js`: a F341 test (hooks in style.css with iOS 6's values, packages.css/sources.css read them, ios7.css
  sets the kit's, the lines are the buttons'); the F333 test's box-line assertion is dropped.

## What failed on the way

- The sheet's separators as a `.5px` flex gap (the kit's literal form) lost some of them: the buttons land on half
  pixels at 3x and Chromium drops some gaps (Remove Source / Refresh showed none). Now the buttons touch and each one
  after the first, or after the title, draws a .5pt inset line: rgba(0,0,0,.4) in White (the dimming's colour, what
  the gap would show), #38383a in OLED Black (the dimmed black page would hide it).
- Those lines first started 1pt in, inside the buttons' transparent 1px border; iOS 7's list buttons now have
  `border-width: 0` (look; their height is fixed, so the box does not move).
- My first capture runs showed the desktop "Open on your iPhone" page and re-used the page between cases (hash-only
  navigation): the script now sets an iPhone UA, the app shell's fake bridge, and goes through about:blank.

- The first gate run failed `theme-palette.test.js` ("every dark rule paints with tokens"): a dark `.action-title`
  rule read `--dk-action-btn`, which is not a palette token and is allowed only on `.action-sheet`/`.action-button`
  selectors. The title's colour is now `--i7-action-cell`, set in ios7.css's two tone blocks; the renders are
  identical to before.

## Checked

- `node --test web/app/ios6-css.test.js`: 20 pass.
- `shots.mjs` (headless Chromium, 390x844 @3x, app shell): the sheet with and without a title, the alert with one
  button, two (with a field, the right one pressed) and three stacked, in iOS 6, iOS 7 White and OLED Black.
  Geometry read back: sheet buttons x=8 w=374, 44pt each, Cancel 8pt under the block and 8pt over the bottom; alert
  270 wide, buttons flush with its sides and bottom, 44pt. iOS 6: all five shots pixel-identical to main.
  Shots in `shots/`: crops of the script's `white-sheet`, `oled-sheet`, `white-alert2` and `oled-alert3`; the iOS 6
  before/after pairs were compared with PIL's `ImageChops.difference` (no bounding box) and not committed.

## Spec review

Fixed: the test now checks `--action-title-pad`; OLED Black's sheet line reads `var(--i7-alert-line)` instead of
repeating its value. Kept on purpose: the alert's bottom buttons take the box's 7pt corners (without them a pressed
edge-to-edge button pokes out of the rounded box), the `--i7-action-line` token, and `--alert-buttons-margin`
repeating the box's 16pt side padding (an era sets both together; a calc from `--alert-pad` can't take one side of a
shorthand). The 44 vs 44.5pt row is under Not verified below.

## Not verified

- On a phone (iPhone 7 / 15): the task is CSS only and the renders are Chromium's; WebKit may round the .5pt
  inset lines differently. Not run on a device because the task didn't call for one and the gate does not.
- The kit puts 44pt buttons under a .5pt line (44.5pt per row); here the line is inside the 44pt button, so a row is
  .5pt shorter than the kit's. Left as is: a 44.5px hook value would put every following button on a half pixel.
- The Add Source alert's Paste row and the countdown alert were not shot in iOS 7; their layout comes from the same
  box padding and row hooks.
- `.alert-button.blue` (altstore.css) has no iOS 7 paint; it was outside this task (F333's list did not cover it).
