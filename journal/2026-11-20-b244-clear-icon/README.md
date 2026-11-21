# B244: the Clear app icon read as iOS's blank placeholder at 20pt

The Clear icon (`native/icon/clear/clear.svg`, Theme > App Icon) was thin white globe lines on light frosted glass.
At notification size (iPhone 15 Pro, B238's `ref/15/screens/b238-reboot-nc.png`) that is a white square with a
faint grey grid: the same look as iOS's blank icon placeholder.

## What changed

- `clear.svg` redrawn, same glass background and lit edge: the globe now sits in a frosted ring with a grey edge
  over a soft shadow, the sphere is smoked slate glass (radial gradient, dark edge, glossy top highlight), and the
  white meridian and parallels are 34 units wide (were 22, white on near-white). Same globe geometry as before.
- `alternates.py render` rerendered every `icon/clear/*.png` (Lite copies the plain ones, as before).
- `Assets.car` / `AssetsLite.car` recompiled on the MBA (Xcode actool), `assets.sources` updated.
- `preview.png`: the new 1024 px master, then 20pt@3x, 20pt@2x and 29pt@3x at true pixel size on a dark ground,
  with Classic's 20pt@2x for comparison. At 40 px it reads as a globe.

## Choice: stronger globe, no LITE sash

The task offered either. I kept Clear the same in both builds: F323 made that choice on purpose, and
`native/test_icons.py` (`test_clear_at_every_size_and_no_sash`, the catalog's `clear-` file names) enforces it.
The smoked sphere alone makes it recognisable in both builds, including the jailbreak build, where a sash would
not have helped.

## Tried, failed

- `native/icon/assets.sh mba` exited 1 with no message. Cause: `glass.py car` leaves an empty `glass/` folder (no
  `CAR_SETS`), and `glass=($(cd glass && ls -d *.icon ... | sed ...))` fails under `set -euo pipefail`. I ran the
  script's own `--compile` step on the MBA for each catalog by hand (the same actool call; the glass list would have
  been empty anyway), copied the .car files back and wrote `assets.sources` as the script does. assets.sh is not
  this task's file: filed B248.

## Not verified

- On a phone: the new icon was not installed on the iPhone 15 Pro and seen in a notification. That needs a Lite
  build with this catalog installed, Clear picked in Theme > App Icon, and a restart (iOS caches notification icons
  until a restart, B238). Judged from the rendered PNGs at true pixel size instead.
- `glass.py`'s Clear colours (iOS 26+ Liquid Glass documents) still describe white lines on white glass. No set is
  compiled from them today (`CAR_SETS` is empty), so nothing ships from them; glass.py is outside this task's files.
