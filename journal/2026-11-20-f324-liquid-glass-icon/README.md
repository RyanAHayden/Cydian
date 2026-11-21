# F324 Real Liquid Glass app icon on iOS 26+

## What I did

- Checked the MBA first: `xcodebuild -version` (with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`,
  since xcode-select points at the CommandLineTools) said **Xcode 26.3 (17C529)**, actool 26.3. No update needed.
- `native/icon/glass.py` (new, stdlib only): writes an Icon Composer document (`<set>.icon/icon.json` + `Assets/*.svg`)
  for every icon set: `AppIcon` and every `Icon-*` set `alternates.py` lists (74). Layers, after tools/icon.svg.in's
  globe, flat as Icon Composer wants: `grid` (front group: meridian, three parallels and the outline, in the theme's
  ink), `sphere` and `rim` (globe group, translucent); the background is icon.json's `linear-gradient` fill from the
  theme's own ramp. All layers `glass: true`, groups `specular: true`. Colours come from tools/icon_themes.py's
  THEMES (the PNG icons' table), so a theme's glass icon matches its picture icon; Clear is white glass lines on a
  frosted white fill. A pair set's dark appearance is the dark theme's layers and fill through
  `image-name-specializations` / `fill-specializations` (key names taken from real Icon Composer documents on GitHub:
  mastodon-ios, Ladybird, QuickLookVideo); a one-icon set names the same icon for both.
- `native/icon/assets.sh`: writes the `glass.CAR_SETS` documents beside each catalog and passes them to actool with
  the .xcassets (works with macOS's bash 3.2 when there are none); `assets.sources` gets a `glass` digest line when
  CAR_SETS isn't empty, so a changed colour or set means a rerun. CAR_SETS is empty for now (below).
- `native/test_icons.py`: `Glass` checks one document per set, every layer image present, dark = the dark icon,
  layer order, colours per theme all different, SVGs well formed; the sources test includes the glass digest.

## actool trial (MBA, Xcode 26.3): the task's plan doesn't hold

Compiled a small catalog: `AppIcon.appiconset` + `Icon-sepia-nord.appiconset` (F323's PNGs) and `AppIcon.icon` +
`Icon-sepia-nord.icon` (glass.py), `--minimum-deployment-target 15.0 --target-device iphone`, both alternates named.
actool took the `.icon` paths as positional inputs beside the .xcassets, no warnings, and its partial Info.plist is the
same shape as today's. But `assetutil --info` on the .car showed:

- **The .icon replaces the same-named PNG set.** None of F323's PNG renditions (`AppIcon60x60@2x.png`,
  `sepia-60x60@2x.png`, ...) are in the .car. In their place actool stores its own flattened renders of the .icon at
  1024 px (`Icon Image`: Any, Dark, and two Tintable greys), and it writes `AppIcon60x60@2x.png` /
  `AppIcon76x76@2x~ipad.png` from the .icon too. So iOS 15-25 would get actool's render of the glass layers, not
  F323's PNGs, and the Lite build's LITE sash is gone (the .icon is the same in both builds).
- **About 3 MB per set.** The layer stack itself is tiny (SVG `Vector` renditions of 400-700 bytes, colours,
  gradients), but the flattened renders are about 600 KB (Any) + 600 KB (Dark) + 350 KB (Tintable) and come twice,
  for the phone and the pad idiom, even with `--target-device iphone`. The two-set car was 6.2 MB. All 74 sets would
  make each .car ~220 MB; F323 chose its 73 alternates for a 16 MB car.
- actool has no `--help`; I found no option to skip the fallback renders before the MBA dropped off again.

So "fall back to F323's PNG sets on iOS 15-25 in the same .car" can't be done with same-named sets, and a glass set
per theme pair doesn't fit. That's a choice for the user (blocked with DECIDE); see the options below. Until then
`glass.CAR_SETS` is empty: assets.sh writes and compiles no .icon, so the committed .car files (F323's) stay right
and nobody who reruns assets.sh gets a 220 MB car.

Options for the user:

1. **Primary only**: `AppIcon` becomes the .icon (Classic in Light, Gunmetal in Dark, real glass in Clear/Tinted on
   iOS 26+), ~3 MB more per .car. The cost: on iOS 15-25 the default icon is actool's flat render of the glass layers
   (Classic colours, no LITE sash). Every other theme's icon stays a PNG set (iOS 26 makes its own Clear/Tinted from
   the picture, as today).
2. **Separate glass alternates**: keep every PNG set as it is (iOS 15-25 unchanged, sash kept) and add `Glass-<x>`
   sets only iOS 26+ picks (AppIcon.swift change, outside this task's files). ~3 MB each: e.g. 4 sets (the default
   pair and three more) ≈ 12 MB per .car. The Lite build would show iOS's icon-change alert on the first switch.
3. Leave the PNG icons; iOS 26 keeps deriving Clear/Tinted from them.

My pick: option 1. It gives real glass for the icon most people have, costs one set, and needs no change to the
switching code. The price is the LITE sash on iOS 15-25 for the default icon only.

## Tried and failed

- The MBA dropped off Tailscale three times this session ("offline, last seen 16m ago", `ssh mba`: connection timed
  out), once in the middle of the full `assets.sh mba` run ("Timeout, server mbas-macbook-air not responding"), even
  with `caffeinate -i -t 2400` started there. The full compile never finished; the small trial above did.

## Not verified

- No .car in this branch has an .icon (CAR_SETS empty, pending the choice), so the phone checks (iPhone 15 Pro in
  Clear and Tinted, iPhone 7 still on its PNG) weren't done: there is nothing new to install yet.
- How iOS 15-25 actually show actool's fallback render: seen in the .car only, not on a phone.
- Whether some actool option skips the fallback renders or the pad idiom (the MBA went offline before I could look).
