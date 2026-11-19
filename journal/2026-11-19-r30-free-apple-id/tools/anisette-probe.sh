#!/bin/sh
# R30: probe public anisette servers from SideStore's list. For each: GET /v3/client_info (anisette-v3) and GET /
# (anisette-v1 headers), with the code, time and what the answer holds, plus the response's Server header.
# Usage: sh anisette-probe.sh servers.json [rounds]
set -u
list=$1; rounds=${2:-1}
addrs=$(grep -o '"address": *"[^"]*"' "$list" | sed 's/.*"\(http[^"]*\)"/\1/')
for r in $(seq 1 "$rounds"); do
  for a in $addrs; do
    v3=$(curl -s -m 10 -o /tmp/ani.$$ -w '%{http_code} %{time_total}' "$a/v3/client_info")
    v3k=$(grep -o '"[a-z_]*":' /tmp/ani.$$ 2>/dev/null | tr -d '":' | tr '\n' ',' | cut -c1-60)
    v1=$(curl -s -m 10 -D /tmp/anih.$$ -o /tmp/ani.$$ -w '%{http_code} %{time_total}' "$a/")
    v1k=$(grep -o '"X-Apple-I-MD[A-Z-]*"\|"X-Apple-I-SRL-NO"\|"X-MMe-Client-Info"' /tmp/ani.$$ 2>/dev/null | tr -d '"' | tr '\n' ',' | cut -c1-60)
    srv=$(grep -i '^server:' /tmp/anih.$$ 2>/dev/null | tr -d '\r' | cut -c9-30)
    printf '%s\t%s\tv3 %s [%s]\tv1 %s [%s]\t%s\n' "$r" "$a" "$v3" "$v3k" "$v1" "$v1k" "$srv"
  done
done
rm -f /tmp/ani.$$ /tmp/anih.$$
