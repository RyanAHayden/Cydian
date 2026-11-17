#!/bin/sh
# Screenshot the 4S into ref/4s/screens/<name>.png. Usage: tools/shot-4s.sh name [host]
# Taps first if wanted: ssh 4s stouch touch X Y  (points, 320x480 portrait)
set -eu
name=$1; host=${2:-4s}
dir=$(dirname "$0")/../ref/4s/screens; mkdir -p "$dir"
f=$(ssh "$host" 'activator send libactivator.system.take-screenshot 2>/dev/null; sleep 2; ls -t /var/mobile/Media/DCIM/100APPLE/*.PNG | head -1')
scp -q "$host:$f" "$dir/$name.png"  # leaves the shot in Camera Roll: no rm on the 4S (AGENTS.md)
echo "$dir/$name.png"
