#!/bin/sh
# F218: 3x renders of bar.html (the Confirm nav bar, real CSS) in each theme -> ../<name>.png
# Run from the repo root: sh journal/2026-11-18-f218-red-confirm-cancel/tools/shots.sh
d=journal/2026-11-18-f218-red-confirm-cancel
page="file://$(pwd)/$d/tools/bar.html"
for t in light:: dark:: dark:nord dark:dracula dark:gunmetal light:solarized light:sepia; do
  theme=${t%%:*}; pal=${t#*:}; pal=${pal%:}
  name=$theme${pal:+-$pal}
  timeout 60 chromium --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=3 \
    --window-size=320,88 --screenshot="$d/$name.png" "$page?theme=$theme&palette=$pal" >/dev/null 2>&1
  echo "$d/$name.png"
done
