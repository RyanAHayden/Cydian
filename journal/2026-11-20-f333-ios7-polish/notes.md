# F333: iOS 7 controls against the kit

The user said some menu items and buttons looked bad under iOS 7. I shot the screens in iOS 7 White and OLED Black at
3x and compared each control with the Teehan+Lax iOS 7 kit (`ref/teehanlax/ios7/sheet.svg`; sizes are the kit's 2x
values halved). Every change is in `web/app/ios7.css`: tokens, one existing hook (`--callout-h`), and look-only rules.
Nothing else changed.

## What was off, and what changed

| Control | Before | Kit | Now |
|---|---|---|---|
| **Alert** (`nav/alert.js`) | still iOS 6: navy glossy box, glossy buttons. ios7.css had no alert rules at all | "Alert": white box with 6.5pt corners, 17.5pt medium title, tinted 17.5pt buttons with no box, a .5pt rgba(0,0,0,.3) line over the buttons and between them, the default button bolder | white box (#1c1c1e in OLED), 7px corners, no border, shadow or gloss; title 17px semibold, message 13px; buttons are flat tinted 17px text, the last non-Cancel button semibold, red buttons `--i7-red`, a countdown dims the text; the field is flat with a .5pt edge; Paste is tinted text; scrim rgba(0,0,0,.4) |
| **Callout menu** (`nav/menu.js`) and the **queue hint** | iOS 6: glossy black, bold, embossed, 38pt | "Contextual menu": flat #232323, 8pt corners, 36pt tall, 14pt light white text, .5pt #b9b9b9 dividers | those values. `--callout-h: 36px` (an existing hook), no drop shadow |
| **Row held for its menu** | white text on iOS 7's grey (iOS 6's held row) | (iOS 7 keeps the row's ink) | label, subtitle, detail and chevron keep their own colours |
| **Counts** (a source's packages, More Sources) | grey iOS 6 pill | Mail's counts: plain grey 17.5pt text | plain 17px `--detail` text, right-aligned |
| **Plain-table keylines** (Sources, Changes, package lists) | 1pt line, full width | "Table View 2": .5pt #c7c7cb, from 15pt in | .5pt, from 15pt; from the label on rows with an icon (52pt on sources, 51pt on packages) |
| **Group headers / footers** | 13px | 14pt (28px at 2x), #6d6d72 | 14px (header line 17px, footer 18px) |
| **Footer links** | browser blue, underlined | (tinted text) | `--i7-tint`, no underline |
| **Action sheet buttons** | 20px text, 4px corners, rgba(248,248,248,.97) | "Actions Sheet": 21.5pt text, 3pt corners, #f3f3f3 buttons, #ebebeb Cancel | 21px, 3px, #f3f3f3 / #ebebeb, pressed #dcdcdc / #d4d4d4 |

Matched the kit already, so left alone: nav bar, bar buttons and back chevron, tab bar, switch, cell height and insets,
chevron colour, detail colour, segmented and scope controls (tinted 1pt outline, 4pt corners, 13pt), search field.

## Geometry left for hooks (filed as F341)

The brief sends geometry that needs a hook to F331, but F331 has already landed, so this is filed as **F341**:

- The action sheet: the kit joins the buttons into one block with .5pt separators, puts the title inside that block,
  and keeps 8pt margins. packages.css has 21px padding, 11px gaps and Cancel 14px further down, with no hooks, so
  iOS 7 still shows separate rounded buttons with the title floating above them (`shots/after/*-actionsheet.png`).
- The alert: the kit's box is 270pt wide with its buttons edge to edge in a 44pt row. sources.css has 340px,
  16/12/11px padding and an 8px gap between buttons. Until hooks exist, the lines are drawn on the alert box itself,
  measured up from its bottom (56px over a row of buttons, 58.5px plus 52px per gap in a stacked column), so they run
  edge to edge as in the kit. A held button's grey shows inset by the padding.
- Theme's Mode at 29pt was already a follow-up from F331.

## What went wrong on the way

- My first plain-table keyline was a `.5px`-tall tile at `100%` (the row's bottom). Chromium does not paint it at 3x:
  `getComputedStyle` showed the layer, but no pixel changed. A 1px tile, or a tile at the top, does paint. Next I drew
  the line at the top of the next row (`.cell + .cell`), but the package list is virtual (`vlist-row`, rows out of
  DOM order and placed by transform), so siblings are not neighbours on screen. The fix is a full-height tile whose
  gradient paints only its last .5px: `--i7-keyline: linear-gradient(to top, var(--keyline) .5px, transparent .5px)`.
- I appended the first block of rules with a shell heredoc instead of the edit tool. The result is the same, but the
  run's rules ask for the edit tool. Every later edit used it.

## Checks

- `node --test web/app/ios6-css.test.js` passes, including the new F333 test (the alert, action sheet, menu, counts,
  headers and keylines hold the kit's values) and C44's test that an era sets no layout. The palette and theme tests
  pass too.
- `node tools/smoke/smoke.mjs` and `--site`: passed.
- 3x shots: headless Chromium at 402x874 @3x, using `journal/2026-11-18-t12-readme-shots/capture.mjs` against
  `worker/node.mjs`. `steps.json` lists the steps and `shoot.sh` runs them per tone (`SP` in it is the folder that
  holds capture.mjs). `shots/before/` and `shots/after/` hold White (`white-*`) and OLED Black (`oled-*`) alerts (two
  buttons with a field, three stacked, one), the action sheet, Sources, Changes and Signing, and after only, the
  callout menu over a held row. The shots were saved as 256-colour PNGs to keep the journal small, and the screens
  that did not change were dropped.
- **iOS 6 unchanged**: all 16 screens were shot in iOS 6 on this branch and on its base (fca4c1fd, a scratch
  worktree), then compared pixel for pixel. 11 are identical. The 5 that differ change only in live data: Home's
  third tile row ("15 Sources Failed to Load" against "See What's New") on the alert, menu and alert screens, and the
  Sources badge (10) on Search. No control's pixels differ. `shots/after/ios6-*.png` are kept for comparison.

## Not verified

- **On a phone**: not shot on the iPhone 7 or the 15 Pro. Only Chromium was used, with the same CSS.
- **Pressed states**: a held alert button, menu item and action-sheet button were not captured. Only their CSS
  values were checked.
- **An alert with four stacked buttons**: no screen opens one. The line positions follow the 43px buttons and 9px
  gaps in sources.css, and only two and three buttons were looked at.
- **Every page of Settings and every sheet**: I shot Home, Sources, a source page, Changes, Installed, Search,
  Settings, Theme, Signing, Device and Manage, plus the action sheet, alerts and menu. Sheets (`nav/sheet.js`) paint
  with the nav bar's and table's tokens, so they were not shot one by one. The package page was not reached (the
  click step opened a source, not a package).
- **iOS 15.0–15.3**: the keyline inset on icon rows uses `:has()` (15.4+). On older versions those rows keep the
  15pt inset.
