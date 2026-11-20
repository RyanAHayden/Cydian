#!/bin/sh
# The showcase video, end to end, in one command:
#
#   marketing/video/make.sh [OUT_DIR]        (default: marketing/video/out, gitignored)
#
# 1. make_state.py: a small made-up rootless apt state (real packages from Procursus, Havoc, Chariz, ElleKit)
# 2. node worker/node.mjs on 127.0.0.1 serves web/app
# 3. capture.mjs: the app's screens at 402x874 (DPR 2) in headless Chromium with a fake native bridge:
#    the jailbreak build (shots-jailbreak.json), the Lite build (shots-lite.json), and the live website's
#    Settings > Signing (shots-web.json: its Free Apple ID group shows only where the Apple relay is on)
# 4. render.mjs: video.html frame by frame -> OUT_DIR/showcase-4x5.mp4 (1080x1350) and showcase-9x16.mp4
#    (1080x1920), 60 fps H.264, no audio; stills of the key beats in OUT_DIR/stills/
#
# Needs: node 22+, python3, chromium, ffmpeg, xz, and the network (the repos and the website).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:-$here/out}
mkdir -p "$out/shots"
out=$(cd "$out" && pwd)
. "$repo/native/brand.env"
version=$(cat "$repo/native/VERSION")

python3 "$here/make_state.py" "$out/state"

port=$((8900 + $$ % 500))
PORT=$port HOST=127.0.0.1 REVIEWS_DB=off node "$repo/worker/node.mjs" >"$out/server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT INT TERM
deadline=$(($(date +%s) + 30))
until curl -sf -o /dev/null "http://127.0.0.1:$port/"; do
  [ "$(date +%s)" -lt "$deadline" ] || { echo "the server didn't start (see $out/server.log)" >&2; exit 1; }
  sleep 0.5
done

cd "$out" # capture.mjs keeps its Chromium profile in the current directory
APP_VERSION=$version timeout 600 node "$here/capture.mjs" "http://127.0.0.1:$port/" shots "$here/shots-jailbreak.json" --native state
PUSH_ON=1 APP_VERSION=$version timeout 600 node "$here/capture.mjs" "http://127.0.0.1:$port/" shots "$here/shots-lite.json" --mode sideload
timeout 300 node "$here/capture.mjs" "https://$BRAND_DOMAIN/" shots "$here/shots-web.json"

timeout 1800 node "$here/render.mjs" shots showcase-4x5.mp4
timeout 1800 node "$here/render.mjs" shots showcase-9x16.mp4 --h 1920
timeout 300 node "$here/render.mjs" shots --still 1.2,3.5,5.2,8.0,11.0,13.5,16.1,17.4,18.6,20.9,22.6,24.4,27.2,30.0,34.8,38.6 --stills stills
echo "done: $out/showcase-4x5.mp4 $out/showcase-9x16.mp4 $out/stills/"
