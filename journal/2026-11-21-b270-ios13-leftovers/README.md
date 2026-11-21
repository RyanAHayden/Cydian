# B270 iOS 13 style leftovers

Look-only changes in `web/app/ios13.css` and `web/app/ios7.css` (iOS 6 untouched), and a new test,
`web/app/ios13-leftovers.test.js`.

## What was wrong and what changed

1. **Home's Discord row and the Settings | Theme row (iOS 13).** Seen in the first renders (`before/ios13-*-home.png`):
   - the tiles sat 10pt from the sides while the grouped tables under them (Settings | Theme, the help links) sat 16pt
     in, so the Theme row didn't line up with the tiles above;
   - both pairs drew a stray hairline along the top of their right half (Discord, Theme), 16pt into it: the
     grouped tables' inset separator, which iOS 13 draws on every second cell, so also on a pair's second half;
   - the split between the halves was iOS 6's 1pt grey line (thick and grey in OLED Black).
   Now Home is inset 16pt (`--home-inset` hook), the tiles are white (#1c1c1e) 10pt cards with no outline, and both
   pairs are split by one .5pt `--divider` line with no top line.
2. **GitHub link with no outline.** The GitHub | Discord pair kept iOS 6's empty fill (Cydia leaves it blank so the
   pinstripes show), so in iOS 13 it was a grey 1pt outline in White and nothing at all in OLED Black, unlike every
   other card. It now gets the card's fill, like the rest. (I read "no outline" as this missing card; the glyph
   itself was left as it is.)
3. **Manage's select circle.** iOS 13: a 1.5pt grey ring, picked a systemBlue disc with a white tick, no rim or
   shadow. iOS 7: the same shape with a thin 1pt ring and a thinner tick (Mail's edit list). The picked row's iOS 6
   pale blue becomes a light grey (#e5e5ea / #ebebf0, #2c2c2e dark). Install IPAs' Manage uses the same circle and
   row and is covered by the same rules.
4. **Manage's Delete.** In both eras it was iOS 6's glossy red box with blue text on top (the bar buttons' tint),
   on iOS 6's blue toolbar in White. Now Delete is flat red text (systemRed in each tone), and the toolbar is the
   bars' flat colour under a hairline. Re-sign and Update were already the eras' tinted text. The toolbar change goes
   past the brief's words, but red text on iOS 6's blue gradient would still not be flat iOS 13/7.
5. **Alerts and prompts (iOS 13).** It had none of its own, so it showed iOS 6's navy box. Now: 270pt box with 14pt
   corners, rgba(255,255,255,.88) / rgba(28,28,30,.92) over `backdrop-filter: blur(20px) saturate(1.8)`, 17pt
   semibold title, 13pt message, a 7pt-rounded field with a .5pt edge, Paste as tinted text, 44pt flat tinted
   buttons edge to edge under .5pt separators (a .5pt line between two side by side), the last (preferred) one
   semibold, a destructive one red, pressed a light wash; scrim 20% / 48% black. The geometry goes through the
   alert hooks (`--alert-w`, `--alert-pad`, ...) as iOS 7's does.
   **iOS 7's** alert (F333/B254) was checked in the renders and already matches its kit (7pt box, flat hairline
   buttons, bold preferred), so it wasn't changed.

## Checks

- Headless Chromium as the sideload app (`capture.mjs --mode sideload`, B272's script with a fake `signing.installed`
  of two apps added so Manage has rows), 402x874 at 3x. Scripts: `mk.py <style> <light|dark>` writes
  `s-<style>-<tone>.json`. Server: `python3 -m http.server` on `web/app`.
- `after/`: for iOS 13 light/dark and iOS 7 White/OLED Black each: `home`, `home-bottom` (Settings | Theme and the
  help links), `about` (About alert), `prompt` (Add Source's field with Paste), `alert-stacked` (three buttons, a red
  one), `manage` (Installed > Manage, one app picked, the toolbar). `before/`: the same screens that changed.
- Zoomed 3x crops checked: the pair split is one clean .5pt line, no top line; the ticks are centred in their discs.
- `node --test web/app/ios13-leftovers.test.js web/app/ios6-css.test.js web/app/ios13-flat.test.js
  web/app/palettes.test.js`: pass (the era sheets still set no layout).

## Spec review

A fresh reviewer read the diff and the brief. Kept, as judgment calls:
- Manage's toolbar going flat, and the picked row going grey: part of items 3 and 4 (a flat Delete on iOS 6's blue
  toolbar, or iOS 13's circle on iOS 6's pale-blue pick, would still be the iOS 6 look the user reported).
- `--home-inset: 16px` moves every Home tile, not only the Discord and Theme rows: that misalignment *was* what made
  the Theme row look wrong.
- "GitHub link has no outline" read as the pair's missing card (see 2). If the user meant the glyph tile itself
  (dark grey on #1c1c1e in OLED Black), that is still open.
- Delete as red text, not a filled red button: iOS 7 and 13 toolbars draw destructive items as red text.
- No tile has an outline in iOS 13 now: iOS 13's inset grouped cards have none.

## Not verified

- **On a phone**: Chromium renders only. `backdrop-filter` blur behind the iOS 13 alert is drawn by Chromium here;
  WebKit on the phone takes the `-webkit-` form too, but it wasn't looked at on a device.
- **Pressed states** (Delete held, an alert button held): rules in place, no shot holds a finger down.
- **Install IPAs' Manage**: same `.manage-check` / `.myipa-row.picked` rules, not rendered (it needs a library
  of IPAs in the fake shell).
