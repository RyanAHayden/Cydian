# F325: five more iOS 6 themes (Leather, Felt, Wood; Legal Pad, Brushed Metal)

Approved page: https://claude.ai/artifact/8bAJR6p72Na76io7Bs4LE1 ('New iOS 6 themes'). Its THEMES table (token values
per mockup) was the starting point for every block.

## What I did

- `web/app/palettes.css`: a token block each, as Linen's. Ids: `leather`, `felt`, `wood` (dark), `legalpad`, `metal`
  (light). Labels in Settings: Leather, Felt, Wood, Legal Pad, Brushed Metal.
  - Textures are CSS gradients in a `--weave` token (the name Linen's texture already had), painted by one new rule
    where Linen's weave goes (grouped pages, boot, filter drop, review sheet, pull-to-refresh area). Nothing animates
    (120 Hz), and the background stays still like the pinstripe (no `background-attachment: local` repaints).
  - Nav bars keep the four layers `html[data-shell="app"] .navbar::before` relies on (it gives layer 1 and 4 size 0
    and stretches 2–3 over the status strip). Leather and Legal Pad's stitch line is layer 1, with the bar's 1px base
    line folded into the gloss's last pixel (`calc(100% - 1px)` stops). Felt and Wood: see-through split gloss over a
    wood-grain fill (layer 4). Brushed Metal: fine streaks as layer 1, base line in the gloss. In the app's strip
    the stitch/streaks are hidden (size 0), the gloss and grain show.
  - Tables are opaque hex (the mockup's rgba glass tables, mixed over their ground) so the contrast test can read
    them; tab bars stay the kit's black (Linen's) for the dark ones; red bar button keeps UIKit's.
  - Back arrows: the kit's back SVG recoloured per palette (generated with the same template as the existing ones,
    each base64 checked byte-for-byte against the generator output).
  - Brushed Metal's silver bars take dark etched text on the title, bar buttons, scope segments and Cancel, and the
    white glyph buttons (Share, Installed mark, queue toggle) are darkened by a filter; Done and red keep white.
  - The two new light palettes are added to every light chrome `:is(...)` list.
- `theme-boot.js` darks/lights and colours; `screens/settings.js` THEME_COLORS; `core/settings.js` options with
  swatches (Settings > Theme > Light / Dark lists).
- `native/Sources/App.swift`: launch grounds for the five (their --pin-* colours), as test_launch_grounds requires
  for every Settings palette.
- `tools/icon_themes.py`: Leather/Felt/Wood as R2 glass globes in their colours, Legal Pad/Brushed Metal as the
  recoloured starburst; `tools/icons.sh` rendered `web/app/icons/themes/<5>/` and `native/icon/themes/<5>/`.
  icons.sh also rewrote `web/app/icons/launch/*.png` (unrelated, render noise); I restored those.
  Contact sheet: `icons.png` (Leather, Felt, Wood, Legal Pad, Metal, then Dracula and Sepia for reference, then two
  LITE).
- Tests: theme-palette.test.js (palette lists, a new F325 test: CSS texture, no url(), four nav bar layers, painted
  on grouped pages, no animation in palettes.css); palettes.test.js (new palettes, --weave allowed in light blocks,
  contrast); tabbar-gloss-css.test.js (10 tab bars); queue-confirm.test.js (light list no longer ends at solarized);
  native/test_launch_grounds.py.

## Screenshots

3x (390x844 @3x), headless Chromium against `node worker/node.mjs` on port 18325 (checked the log names this
worktree's web dir), `capture.mjs` from F200 with `mkshots.mjs` → `shots.json`. Per theme `<theme>-sheet.jpg`:
Home, Changes, Settings, Theme list, a package page (Provenance), an alert. `navbars-3x.png`: the bars at full 3x.

Looked at each: text readable on every page; stitches, grain, felt, ruled paper and brushed silver show; the alert
keeps the kit's blue. First pass found Brushed Metal's glyph buttons white on silver: fixed (filter) and reshot.

## Not verified

- The jailbreak app / sideload IPA on a phone: no device test (task doesn't ask; the iPhone 7 needs its lock). The
  app's status-strip `::before` stretch with the stitch layer hidden is reasoned from the CSS, seen only in the
  website layout (Chromium has no data-shell="app").
- Launch grounds in the native shell (App.swift) only compile-checked by the gate; not seen on a device.
- Tab bar selected colour per theme (the mockup's tab-on/tab-glow): the app has no token for it, so the kit's blue
  glow stays. Not asked by the brief's text; left as is.
- iOS Safari rendering of the repeating gradients (only Chromium checked).
