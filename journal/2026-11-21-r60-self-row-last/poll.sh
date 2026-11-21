#!/bin/sh
# R58's poll.sh, every 1 s: for up to $1 seconds, the run page's rows and Log with a timestamp, into $2.
# CDP on $CDP_PORT (default 9368). Once iFizBox closes to install itself, each poll prints the error and goes on.
S=$(dirname "$0")
end=$(( $(date +%s) + $1 ))
while [ "$(date +%s)" -lt "$end" ]; do
  echo "=== $(date +%T.%3N)" >> "$2"
  CDP_PORT=${CDP_PORT:-9368} timeout 5 node "$S/ev.mjs" '(() => { const t = document.body.innerText; const i = t.lastIndexOf("Running"); const j = t.lastIndexOf("Complete"); return t.slice(Math.max(i, j, t.length - 5000)); })()' >> "$2" 2>&1
  sleep 1
done
