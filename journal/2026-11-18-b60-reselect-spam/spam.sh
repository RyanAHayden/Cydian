#!/bin/sh
# Fire 5 taps on the Installed tab ~60 ms apart (each call is ~430 ms over ssh, so they overlap), shooting midway.
cd /home/ryha/runs/iFizBox/s1 || exit 1
pids=""
for i in 1 2 3 4 5; do
  tools/ui-7.sh B60 tap 522 1290 & pids="$pids $!"
  sleep 0.06
done
tools/ui-7.sh B60 shot "b60-$1-mid" >/dev/null
for p in $pids; do wait "$p"; done
sleep 1
tools/ui-7.sh B60 shot "b60-$1-end"
