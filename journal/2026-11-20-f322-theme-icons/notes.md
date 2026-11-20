# F322 Per-theme home-screen icons

The pick: R2 (blue glass globe, bright centre) per dark theme, the starburst recoloured for the light themes, as on
https://claude.ai/artifact/Nadcgkh55icsRMMMFQYzP5, section "One icon per theme".

## What I did

- `tools/icon_themes.py`: the concept generators (control session scratchpad `gm/`: gen_halo/gen_r4 `radial()`,
  gen_themes `THEMES`/`glass()`/`ramp()`, gen_r6 `tone()`, and `docs/concepts/icon/dark/gen.py`'s `bg()`/`svg()`)
  folded into one stdlib + numpy/scipy/Pillow script, with a single theme table `THEMES`. On every run it checks the
  table against theme-boot.js's `darks`/`lights` and refuses a mismatch. It writes one master SVG per theme
  (Classic = `web/app/icons/icon.svg` as is). `--names` prints the names for the shell loop.
- `tools/icons.sh`: a new block at the end. It sashes each theme's master with the same orange LITE sash as today
  (the existing `sashed()`, given another `$master`) and renders:
  - `native/icon/themes/<theme>/AppIcon{,Lite}{20,29,40,60}x..@{2x,3x}.png`, `AppIcon{,Lite}60x60.png`,
    `AppIcon{,Lite}1024.png`: every AppIcon size, the same names as `native/icon/`'s own, so a later build or
    asset-catalog step can use a theme folder in place of `icon/`. Lite also gets the 60x60 1x the top level lacks,
    so every theme has plain + Lite at every size.
  - `web/app/icons/themes/<theme>/icon{,-lite}-{180,192,512}.png` (flat: apple-touch-icon and manifest sizes) and
    `icon{,-lite}-glossy-{76,152,228}.png` (iOS 6 corners: the Home header's sizes). I read "at every AppIcon size"
    for the web folder as the sizes the web side uses (it never uses 20/29/40pt). The 1024 masters only went to
    native, where the asset catalog needs them.
- Tests: `web/app/icons/test_icons.py` `ThemeIcons` and `native/test_icons.py` `ThemeIcons`: every theme-boot.js theme
  has plain + Lite at every size, no folder for a theme that no longer exists, Classic is byte-for-byte the real icon,
  no two themes share an icon, and the generator's table equals theme-boot.js's lists.
- `docs/concepts/icon/README.md`: a short "One icon per theme" section that points at the generator.

Output size: native/icon/themes 12 MB (mostly the 1024 masters, about 0.6 MB each), web/app/icons/themes 6.9 MB. No
file is over the 1 MB size guard, and both folders are on its allowlist anyway.

## Checks

- Each theme's master SVG is **byte-identical** to the concept's (`th-<theme>.svg` for the dark themes, `lt-sepia.svg`,
  `lt-solarized.svg`; Classic equals `web/app/icons/icon.svg`). Same PIL and JPEG settings, same seed.
- Compared with the images on the page (240 px, corners already rounded): mean difference 0.7–1.2 out of 255 per
  channel, 99th percentile 8–12, measured inside the rounded square only. That is resampling noise.
- `contact-sheet.png`: the repo's 180 px plain and Lite beside the page's, one row per theme. They match. The only
  difference you can see is the page's baked-in rounded corners.
- Re-running `tools/icons.sh` leaves every existing icon unchanged. The launch images under
  `web/app/icons/launch/` came out different (the launch-image renderer is not part of this task, and its inputs
  have moved on since it last ran), so I restored them to keep this diff to the theme icons.

## Tried and dropped

- None of the theme icons failed. One bug, caught before the first render: `tone()` read `icon_bg.STOPS` after the
  dark themes had repointed it at their own ramp. It now reads the original ramp once, up front.

## Not verified

- On a phone: nothing uses these icons yet. Switching the home-screen icon with the theme (alternate icons, an asset
  catalog per theme) is the follow-up task "App icon follows the theme", so no device or Simulator check was possible
  here.
- Asset catalogs: no `Assets.car` holds the theme icons. That needs actool on the Mac and belongs to the follow-up.
- The launch images that `tools/icons.sh` now writes differently: I didn't check why. It's out of scope; they
  were restored, not committed.
