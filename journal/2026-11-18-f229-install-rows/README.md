# F229 Website Home: the two install rows read apart

A visitor kept tapping the bright purple jailbroken tile instead of the green one. The user picked option 1
(Lavender tint) of the concept.

## What changed

- `web/app/screens/home.js`
  - Green row (appRow): `Install ${NAME} Lite`, subtitle "For any iPhone · no jailbreak needed" (`APP_ROW`).
  - `appRowWords(offer)`: on a jailbroken device the same green row hands over the .deb; it keeps "The .deb for
    your jailbreak" as the brief says, and its label becomes `Install ${NAME}` (no "Lite"). **Decision:** the brief
    only named the label for the Lite case; calling the .deb "Lite" would be wrong, so drawApp sets the label
    with the subtitle.
  - Purple row (debTile): `tile()` got a `lead` option (a `.home-tile-lead` span before the label): "Jailbroken?"
    then `Install ${NAME}`; subtitle "Tweaks, themes and apt". Still 58px tall, as the green stack row.
- `web/app/home.css`: `.home-row.purple` drops the gradient, white text/emboss and white chevron. Now
  `--tile-purple` (#f5f0ff) and `--tile-purple-edge` (#a9a2b8), normal label and subtitle colours, the default grey
  chevron. `.home-tile-lead` is #6a4fa0, normal weight (white when the row is held, like the label). Dark:
  `--tile-purple: var(--dk-lavender)`, the lead `var(--dk-lavender-text)` (lighter, so it reads on dark), edge =
  `--tile-edge`.
- `web/app/ios6.css`, `web/app/palettes.css` (outside the brief's file list, additive lines only): every dark palette
  got `--dk-lavender` / `--dk-lavender-text` beside its `--dk-green` (OLED #1a1426/#b49ae0, gunmetal #3d344f/#c6b3ea,
  midnight #221a3a, linen #332b42, nord #463e5c/#b48ead (Nord's purple), dracula #3e3354/#bd93f9 (Dracula's purple)).

## Tried and failed

- First cut put fixed dark colours in home.css (#1a1426, and a gunmetal override). The gate's
  theme-palette.test.js ("every dark rule paints with tokens") refuses fixed colours in dark rules, so they
  moved into palette tokens as above. The glyph's padlock is now on
  a #8a5cd0 -> #5b2fa3 gradient, a second background layer (`background-size: 21px 21px, 100% 100%` so the
  gradient fills the square), keyhole #6f43b9 (the gradient's middle).
- README.md, docs/release.md: "Install Full iFizBox" -> "Jailbroken? Install iFizBox"; Home's "Install iFizBox App"
  -> "Install iFizBox Lite" (README Sideload section, release.md's no-bridge fallback).
- Test: `web/app/screens/home-installrows.test.js` (the words, the lead span, the CSS tint/no gradient/dark value).

## Check

- 3x headless Chromium render, 390 wide, `node worker/node.mjs` + `capture.mjs` (F174's CDP driver, with a
  `clipshot` step) driven by `shots.json`: `rows-light.png`, `rows-dark.png` (OLED), `rows-dark-gunmetal.png`,
  and the whole Home in `home-light.png` / `home-dark.png`. The rows read as in the brief: pale green and pale
  lavender, same height, grey chevrons, "Jailbroken?" lavender and regular weight, padlock on purple gradient.
- `tools/check.sh` via `agent-runner done`.

## Not verified

- Compared against the concept artifact (https://claude.ai/artifact/NNeJyiLVk6q3GxHLSjhDSm) only by the brief's
  written values: the artifact needs a claude.ai login, which an unattended session doesn't have.
- docs/signing.md and docs/settings.md still say "Home's Install iFizBox App" in places; they are outside this
  task's files (and some mean Settings > Signing's row, which keeps its name). Left as is.
- The renders were taken before the colours moved into tokens. OLED and gunmetal have the same values as before,
  so those shots still hold. Midnight, linen, nord and dracula were not rendered; their lavender values were
  picked by hand to sit a step off each palette's `--table`.
- Not looked at on a real iPhone (website only; no device step in the brief).
