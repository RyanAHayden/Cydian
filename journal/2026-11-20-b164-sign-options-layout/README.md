# B164: Sign Options page layout

## Cause

My IPAs' Sign Options page (web/app/screens/myipas.js renderOptions) copied the signing sheet's rows but not the
CSS context they rely on:

- **Switches next to their labels.** The arm64e Fix-Up and Keep Bundle ID rows are `.cell-inner.has-switch` holding a
  bare `.cell-label` and the switch. `.cell-label` has no `flex: 1` (Settings rows wrap the label in `.cell-text`,
  which has), so nothing pushed the switch to the right.
- **Choose floating over the footer.** `.sign-browse` is `position: absolute` in its cell, and only
  `.sign-files .cell` / `.sign-sheet .sign-files-cell` are `position: relative`. Sign Options is in neither, so the
  button was placed against a far ancestor and landed on the arm64e group's footer.
- **'The App's' short of the edge.** `.sign-row` keeps `padding-right: 78px` for that absolute button.

## Fix

- ios6.css: `.cell-inner.has-switch > .cell-label { flex: 1; min-width: 0 }`: a bare label before a switch takes the
  room, so the switch sits at the right edge (9px in, as every switch row). This fixes the same latent case in the
  signing sheet's Keep Bundle ID row. Browse's section visibility rows (folder, label, switch) get it too, which
  changes nothing visible: the switch was already last.
- myipas.js: the Icon row is now built by an exported `iconCell(ed, { iconPNG })`. Choose (or Reset) is a child of
  the row after the value, and the row has `.has-browse`.
- ios6.css: `.sign-row.has-browse { padding-right: 9px }` and `.sign-row.has-browse > .sign-browse { position:
  static; transform: none; flex: none }`. The button is a flex item at the right edge with the value right-aligned
  just before it. The Settings > Signing and signing-sheet rows keep their absolute buttons as before.
- Test: web/app/screens/myipas-signoptions-layout.test.js pins the button inside the row (fake DOM), Reset going back
  to Choose in place, and the CSS rules above. It also checks that both switch rows are a label and then a switch
  inside a `.has-switch` row.

## Check

`capture.mjs` (B137's, plus a 390x844 DPR 3 viewport, a `DARK` media switch and a `library.list` fake with one IPA
that has an extension), using `script.json` (light) and `script-dark.json` (Mode Dark, Gunmetal), with `--mode
sideload`, against `python3 -m http.server` on web/app:

- `light.png`, `dark-gunmetal.png`: the whole page. `*-icon-3x.png` and `*-switch-3x.png` are 3x nearest-neighbour
  crops of the Icon row and the arm64e row.
- Measured rects (CSS px; the cell-inner is 11..379): every switch spans 293..370, so its right edge is 9px in. Choose
  spans x 306..370 and y 240..269, inside its row's 233..276. 'The App's' ends at 296, 10px before the button.

Tried first: emulating `prefers-color-scheme: dark` alone. The shot stayed light because Mode defaults to Light
(theme-boot.js), not Automatic, so the dark shot sets `ifizbox.appearance` instead.

## Not verified

- On a real phone (sideload app on the iPhone 7 / 18 Pro): the task asks only for the Chromium shots, and the
  iPhone 7 runs the jailbreak build, which has no Sign Options page.
- Tapping Choose to open the file picker in Chromium: the label's `htmlFor` link to the hidden input did not change,
  and headless Chromium shows no picker. The unit test covers Reset going back to Choose.
- The signing sheet's Keep Bundle ID row after the shared rule: not shot. Its switch moves to the right edge by the
  same rule.
