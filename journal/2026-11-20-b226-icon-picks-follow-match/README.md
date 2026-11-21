# B226: Theme > App Icon picks follow Match Theme

The picks group (Light, Dark) was drawn once, while Match Theme was on, so its details and thumbnails showed the
themes' icons; turning Match Theme off only unhid it.

## Done
- `web/app/screens/settings.js`: `redrawPicks(pickGroup, rows)` sets each row's detail (`iconLabel(iconOf(tone))`)
  and thumbnail `src` (`iconSrc`), making a new `<img>` like nav/ui.js does when the old one was dropped after a
  failed load. The `iconMatch` listener in `appIconGroups` calls it before `follow()`, so the group shows the
  right icons as it fades in.

## Checked
- Headless Chromium (a scratch copy of tools/smoke/smoke.mjs's launcher, fake bridge): Match Theme on, lightIcon
  set to Gunmetal, open #/home/settings/theme. Before: Light row "Classic". After turning Match Theme off: Light
  "Gunmetal", both thumbnails `appicon/gunmetal.png`; back on: Light "Classic" again. No page errors.
- `tools/check.sh` through `run done`.

## Not verified
- The thumbnails actually painting: web/app has no appicon/*.png (the shell serves them), so in Chromium the
  images fail and are dropped; only the `src` set right after the change was checked.
- On the iPhone 7 itself: not run (the jailbreak .deb would need a build and install for a one-line UI change).
