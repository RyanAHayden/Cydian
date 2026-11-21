#!/bin/sh
# Every 2 s for up to $1 seconds: the run page's rows and Log (iFizBox's page text) with a timestamp, into $2.
S=$(dirname "$0")
end=$(( $(date +%s) + $1 ))
while [ "$(date +%s)" -lt "$end" ]; do
  echo "=== $(date +%T.%3N)" >> "$2"
  timeout 10 node "$S/ev.mjs" '(() => { const t = document.body.innerText; const i = t.lastIndexOf("Running"); const j = t.lastIndexOf("Complete"); return t.slice(Math.max(i, j, t.length - 5000)); })()' >> "$2" 2>&1
  sleep 2
done
