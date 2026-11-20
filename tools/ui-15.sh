#!/bin/sh
# Drive the iPhone 15 Pro's screen (iOS 27, no jailbreak; iFizBox's sideload/Lite test phone, on this machine's USB)
# from Linux: go-ios (tunnel, disk image, install, screenshots) + WebDriverAgent on the phone (touches, buttons).
# One agent at a time: every action needs the UI lock.
#   tools/ui-15.sh lock ME            take the lock (fails, naming the holder, if someone else has it)
#   tools/ui-15.sh ME up              start tunnel, disk image, WebDriverAgent (every command does this when needed)
#   tools/ui-15.sh ME tap X Y         tap at screenshot pixels (1179x2556 portrait)
#   tools/ui-15.sh ME swipe X1 Y1 X2 Y2 [secs]
#   tools/ui-15.sh ME type TEXT       type into the focused field
#   tools/ui-15.sh ME open URL        open a URL, e.g. ifizbox://sources
#   tools/ui-15.sh ME launch BUNDLE   launch (or bring forward) an app; the brand's ID if BUNDLE is omitted
#   tools/ui-15.sh ME install IPA     install an .ipa (sign it for this phone first)
#   tools/ui-15.sh ME home            Home
#   tools/ui-15.sh ME lock-button     lock the screen;  ME wake: wake and unlock it (no passcode on this phone)
#   tools/ui-15.sh ME shot NAME       screenshot -> ref/15/screens/NAME.png
#   tools/ui-15.sh ME source          the frontmost app's accessibility tree (XML)
#   tools/ui-15.sh unlock ME          release it; always do this when done, even after a failure
# ME is your task ID. A lock unused for 30 minutes is stale and can be taken over. Setup: docs/iphone15.md.
set -eu
lock=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-15-ui.lock  # outside the repo: shared by every worktree on this machine
run=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-15           # logs of the background tunnel, WDA and port forward
rig=${IFIZBOX_15_RIG:-$HOME/.local/share/ifizbox-rig}  # WDA.ipa, ddi/, ca-bundle.pem (docs/iphone15.md)
udid=${IFIZBOX_15_UDID:-00008130-0018450C3661001C}
wda=http://127.0.0.1:8100
stale=30

holder() { cat "$lock/owner" 2>/dev/null || echo '?'; }
case $1 in
  lock)
    if ! mkdir "$lock" 2>/dev/null; then
      if [ "$(holder)" != "$2" ] && [ -z "$(find "$lock/owner" -mmin +$stale 2>/dev/null)" ]; then
        echo "iPhone 15 UI is locked by $(holder) (touched $(date -r "$lock/owner" +%H:%M)); try again later" >&2
        exit 1
      fi
      echo "taking over from $(holder)" >&2
    fi
    echo "$2" > "$lock/owner"; exit 0 ;;
  unlock)
    [ "$(holder)" = "$2" ] && rm -rf "$lock"; exit 0 ;;
esac

me=$1; cmd=$2; shift 2
[ "$(holder)" = "$me" ] || { echo "take the lock first: tools/ui-15.sh lock $me (held by $(holder))" >&2; exit 1; }
touch "$lock/owner"
mkdir -p "$run"
here=$(cd "$(dirname "$0")/.." && pwd)
case ${1:-} in /*|'') ;; *) [ "$cmd" = install ] && set -- "$PWD/$1" ;; esac
cd "$rig"  # go-ios keeps its pairing identity (selfIdentity.plist) in the current directory
gi() { ios --udid="$udid" "$@" 2>>"$run/ios.log"; }
bg() { name=$1; shift; setsid nohup ios --udid="$udid" "$@" >"$run/$name.log" 2>&1 < /dev/null & }
wait_for() { i=0; until eval "$1"; do i=$((i + 1)); [ $i -lt "$2" ] || return 1; sleep 1; done; }

up() {
  curl -sf -m 3 "$wda/status" >/dev/null 2>&1 && return 0
  gi list | grep -q "$udid" || { echo "iPhone 15 ($udid) isn't on USB, or isn't trusted" >&2; exit 1; }
  if ! ios tunnel ls 2>/dev/null | grep -q "$udid"; then
    bg tunnel tunnel start --userspace
    wait_for 'ios tunnel ls 2>/dev/null | grep -q "$udid"' 30 || { echo "tunnel didn't start: $run/tunnel.log" >&2; exit 1; }
  fi
  # The disk image stays mounted until the phone reboots. Apple's signing server needs Apple's root CA (ca-bundle.pem).
  gi image list | grep -q signature ||
    SSL_CERT_FILE=$rig/ca-bundle.pem gi image mount --path="$rig/ddi/iOS_DDI/Restore" >/dev/null
  ss -ltn 'sport = :8100' | grep -q 8100 || bg forward forward 8100 8100
  if ! gi ps | grep -q WebDriverAgentRunner; then
    bg wda runwda --bundleid=com.ryha.wda.xctrunner --testrunnerbundleid=com.ryha.wda.xctrunner \
      --xctestconfig=WebDriverAgentRunner.xctest
  fi
  wait_for 'curl -sf -m 3 "$wda/status" >/dev/null 2>&1' 40 ||
    { echo "WebDriverAgent didn't answer: $run/wda.log (re-sign it? docs/iphone15.md)" >&2; exit 1; }
}
sid() {  # WDA's current session, or a new one (opening one launches nothing)
  s=$(curl -s -m 10 "$wda/status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionId") or "")')
  [ -n "$s" ] || s=$(curl -s -m 30 -X POST "$wda/session" -H 'Content-Type: application/json' \
    -d '{"capabilities":{}}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionId"])')
  echo "$s"
}
post() {  # post PATH JSON: under the session; prints WDA's error, if any, and fails
  curl -s -m 60 -X POST "$wda/session/$(sid)$1" -H 'Content-Type: application/json' -d "$2" |
    python3 -c 'import json,sys; v=json.load(sys.stdin).get("value"); e=isinstance(v,dict) and v.get("error"); sys.exit(e and print(e, v.get("message",""), file=sys.stderr) or 0)'
}
pt() { python3 -c "print(round($1/3))"; }  # screenshot pixels -> points (3x)

case $cmd in
  up) up ;;
  tap)
    up; post /actions "{\"actions\":[{\"type\":\"pointer\",\"id\":\"f\",\"parameters\":{\"pointerType\":\"touch\"},\"actions\":[
      {\"type\":\"pointerMove\",\"duration\":0,\"x\":$(pt "$1"),\"y\":$(pt "$2")},{\"type\":\"pointerDown\"},
      {\"type\":\"pause\",\"duration\":80},{\"type\":\"pointerUp\"}]}]}" ;;
  swipe)
    up; ms=$(python3 -c "print(round(${5:-0.3}*1000))")
    post /actions "{\"actions\":[{\"type\":\"pointer\",\"id\":\"f\",\"parameters\":{\"pointerType\":\"touch\"},\"actions\":[
      {\"type\":\"pointerMove\",\"duration\":0,\"x\":$(pt "$1"),\"y\":$(pt "$2")},{\"type\":\"pointerDown\"},
      {\"type\":\"pointerMove\",\"duration\":$ms,\"x\":$(pt "$3"),\"y\":$(pt "$4")},{\"type\":\"pointerUp\"}]}]}" ;;
  type) up; post /wda/keys "$(python3 -c 'import json,sys; print(json.dumps({"value": list(sys.argv[1])}))' "$1")" ;;
  open) up; post /url "$(python3 -c 'import json,sys; print(json.dumps({"url": sys.argv[1]}))' "$1")" ;;
  launch)
    [ $# -gt 0 ] || { . "$here/native/brand.env"; set -- "$BRAND_BUNDLE_ID"; }
    up; post /wda/apps/activate "{\"bundleId\":\"$1\"}" ;;
  install) gi install --path="$1" | tail -1 ;;
  home) up; curl -sf -m 30 -X POST "$wda/wda/homescreen" >/dev/null ;;
  lock-button) up; curl -sf -m 30 -X POST "$wda/wda/lock" >/dev/null ;;
  wake) up; curl -sf -m 30 -X POST "$wda/wda/unlock" >/dev/null ;;
  shot)
    dir=$here/ref/15/screens; mkdir -p "$dir"
    gi screenshot --output="$dir/$1.png" >/dev/null || { up; gi screenshot --output="$dir/$1.png" >/dev/null; }
    echo "$dir/$1.png" ;;
  source) up; curl -s -m 60 "$wda/source" | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])' ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
