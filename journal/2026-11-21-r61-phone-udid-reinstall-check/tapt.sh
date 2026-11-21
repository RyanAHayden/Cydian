#!/bin/sh
# tapt.sh "<exact text>" [n]: tap that element on the iPhone 15 Pro (where.sh, then ui-15.sh tap under R61's lock).
# R60's helper with R61's lock.
S=$(dirname "$0")
xy=$(sh "$S/where.sh" "$1" "$2")
[ -n "$xy" ] || { echo "not on screen: $1"; exit 1; }
"$S/../../tools/ui-15.sh" R61 tap $xy > /dev/null 2>&1
echo "tapped $1 at $xy"
