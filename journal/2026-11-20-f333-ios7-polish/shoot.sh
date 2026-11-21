#!/bin/bash
# shoot.sh <steps.json> <outdir>: runs the steps as White (white-*), OLED Black (oled-*) and iOS 6 light (ios6-*).
set -u
SP=/home/ryha/.cache/claude-tmp/claude-1000/-home-ryha-runs-iFizBox-s3/85ee97cc-28e1-4cd0-9c8c-47462555bb4a/scratchpad
steps=$1; out=$2; only=${3:-white,oled,ios6}
mkdir -p "$out"
cd "$SP"
for v in white oled ios6; do
  case ",$only," in *",$v,"*) ;; *) continue ;; esac
  case $v in
    white) sed -e 's/__TONE__/light/' -e 's/__P__/white/g' "$steps" > "$SP/run-$v.json" ;;
    oled) sed -e 's/__TONE__/dark/' -e 's/__P__/oled/g' "$steps" > "$SP/run-$v.json" ;;
    ios6) sed -e 's/__TONE__/light/' -e 's/__P__/ios6/g' -e "s/'ios7'/'ios6'/" "$steps" > "$SP/run-$v.json" ;;
  esac
  timeout 300 node "$SP/capture.mjs" "${BASE:-http://127.0.0.1:8761/}" "$out" "$SP/run-$v.json" &
done
wait
