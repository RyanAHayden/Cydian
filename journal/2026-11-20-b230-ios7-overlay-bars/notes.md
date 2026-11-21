# B230: iOS 7 looks for the bars over the page

## Cause

The banner's Upgrade and the reload bar's Cancel are `.bar-button.done`. Their gloss-blue fill comes from
sources.css's `--done-btn*` tokens, which ios7.css never cleared, so iOS 7 drew its tinted text on the iOS 6 blue
button (ref/7/screens/b221-relaunch1.png). The banner's Upgrade also took the iOS 7 bar buttons' 44px line-height in
its 30px box, which pushed the label down.

## What changed (web/app/ios7.css only)

- `--done-btn-edge`, `--done-btn-edge-top`, `--done-btn`, `--done-btn-pressed` cleared in White and OLED Black: Done is
  bold tinted text, the same as the other iOS 7 bar buttons. This applies to every Done bar button, in the nav bar
  too, and to the undo bar's Undo, because they all read the same tokens.
- Banner: iOS 7's flat dark banner (#1a1a1a in White; #1c1c1e with a #38383a hairline in OLED so it shows on the black
  page). No gloss, shadow or embosses, a semibold title, a white message, a 7px icon corner, a fainter timer line.
  Upgrade is 15px semibold #0a84ff with its line-height set back to 28px.
- Reload bar: a flat iOS 7 toolbar, the tab bar's #f7f7f7 under a hairline with black semibold text and the grey
  spinner in White; black under a #262626 hairline with white text and the white spinner in OLED.
- No layout: only tokens and the type and paint properties C44 allows (`ios6-css.test.js` checks this).

## Checked

Headless Chromium at 402x874 @3x, with `journal/2026-11-18-t12-readme-shots/capture.mjs` against a static server
on web/app/ and the steps in `steps.json`. The banner and reload bar are shown from the page (`showBanner`,
`showReloadBar`). Shots: `shots/white.png`, `shots/oled.png`, and `shots/ios6-unchanged.png` (iOS 6 still glossy and
blue).

## Not verified

- **The iPhone 7 itself**: not shot on the phone. Its .deb would have to be rebuilt and swapped while other slots
  overwrite it. The Chromium shots use the same CSS.
- **The pressed look**: Upgrade/Cancel held down was not captured. It falls to the iOS 7 bar-button `:active`
  opacity .3, the same as the nav bar.
- **The website's other palettes under iOS 7** (Metal etc.): iOS 7 has only White and OLED, so they were not checked.

## Follow-up

- F335 (low): the undo bar keeps its iOS 6 background. It was not named in this task.
