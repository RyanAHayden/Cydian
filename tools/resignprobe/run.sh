#!/usr/bin/env bash
# One step of the re-sign probe matrix on the iPhone 15 Pro (docs/iphone15.md; hold its lock: tools/ui-15.sh lock ME):
# sign the probe with one of our signers and one identity, install it over the copy on the phone, launch it, and
# print its report (which markers it kept). Results go to tools/resignprobe/build/log.jsonl.
#   tools/resignprobe/run.sh ME SIGNER IDENTITY [--no-groupfix] [--from-last] [--probe NAME]
#   tools/resignprobe/run.sh ME check          launch the installed probe again and print its report (no signing)
#   tools/resignprobe/run.sh ME uninstall [NAME]
# SIGNER:   web (website: websign-job.js + zsign WebAssembly, in Node), native (the app's signer, native/sign, as
#           signbench-linux: native/sign/bench/build.sh linux), sidedrop (SideDrop's way: native zsign, the profile's
#           entitlements with its application-identifier as the keychain group, no group fix)
# IDENTITY: names in identities() below (certificates and profiles from ~/sync/default/signing, never in the repo)
# --from-last: re-sign the IPA the last step installed instead of the freshly built one (an app signed twice)
# --probe NAME: tools/resignprobe/build/NAME.ipa (build.sh's suffix copies: probe-two, ...); default probe
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
# SIGNER_REPO: sign with another checkout's signers (its web/app and signbench-linux), e.g. main's, for a before/after
signers=${SIGNER_REPO:-$repo}
. "$repo/native/brand.env"
me=$1; signer=$2
rig=${IFIZBOX_15_RIG:-$HOME/.local/share/ifizbox-rig}
udid=${IFIZBOX_15_UDID:-00008130-0018450C3661001C}
S=${SIGNING_DIR:-$HOME/sync/default/signing}
b=$here/build
sec=${XDG_RUNTIME_DIR:-/tmp}/ifizbox-probe-keys; mkdir -p "$sec"; chmod 700 "$sec"
ui() { "$repo/tools/ui-15.sh" "$me" "$@"; }
gi() { (cd "$rig" && timeout 60 ios --udid="$udid" "$@"); }

# identity NAME -> p12 password profile: the .p12, its password and the provisioning profile
identities() {
  case $1 in
    A)  echo "$S/rsideload/cert.p12|$(cat "$S/rsideload/password.txt")|$S/rsideload/sidedrop-adhoc.mobileprovision" ;;  # SideDrop's
    A2) echo "$S/rsideload/cert.p12|$(cat "$S/rsideload/password.txt")|$S/rsideload/RSideload.mobileprovision" ;;      # same cert and App ID, another profile
    B)  echo "$S/cert.p12|$(cat "$S/p12-password.txt")|${PROBE_PROFILE_B:?PROBE_PROFILE_B: a profile for the same App ID with cert.p12}" ;;
    BW) echo "$S/cert.p12|$(cat "$S/p12-password.txt")|$S/adhoc.mobileprovision" ;;                                   # other cert, wildcard App ID
    X)  echo "$S/211483/211483.p12|12345|$S/211483/211483.mobileprovision" ;;                                         # another team
    *)  echo "unknown identity $1" >&2; exit 2 ;;
  esac
}

report() {
  rm -rf "$b/pull"; mkdir -p "$b/pull"
  for _ in 1 2 3 4 5 6; do
    sleep 2
    gi fsync --app="$1" pull --srcPath=/Documents/probe-log.jsonl --dstPath="$b/pull" >/dev/null 2>&1 && [ -s "$b/pull/probe-log.jsonl" ] && break
  done
  [ -s "$b/pull/probe-log.jsonl" ] || { echo "no report from $1" >&2; return 1; }
  # every launch since the last step's (the first launch after an install is the one that tells)
  python3 -I - "$b/pull/probe-log.jsonl" "$3" "$b/log.jsonl" "$b/seen-$1" <<'EOF'
import json, os, sys
log, step, out, seenf = sys.argv[1:5]
seen = int(open(seenf).read()) if os.path.exists(seenf) else 0
runs = [json.loads(l) for l in open(log) if l.strip()]
new = runs[seen:] if len(runs) > seen else runs[-1:]  # by line: the launch counter (NSUserDefaults) can miss a write
for r in new:
    r["step"] = step
    open(out, "a").write(json.dumps(r) + "\n")
    print(f"{step}: launch {r['launch']} appID {r['appID']} keychain {r['keychainGroups']} groupfix {r['groupfix']}")
    for row in r["rows"]:
        print(f"  {row['store']:9} {row['status']:5} {row.get('extra', '')}")
    print("  visible:", ", ".join(r["visible"]))
open(seenf, "w").write(str(len(runs)))
EOF
  ui shot "probe-$(echo "$3" | tr ' /' '__')" >/dev/null || true
}

# go-ios starts the app itself (WebDriverAgent isn't needed); the screen must be unlocked for it to come forward.
launch() { ui wake >/dev/null 2>&1 || true; gi launch "$1" >/dev/null 2>&1; }

probe=probe
case $signer in
  check) id=${PROBE_ID:-$BRAND_BUNDLE_ID.probe}; gi kill "$id" >/dev/null 2>&1 || true; launch "$id"; report "$id" x "check ${3:-}"; exit ;;
  uninstall) gi uninstall "$BRAND_BUNDLE_ID.probe${3:+.$3}"; exit ;;
esac
ident=$3; shift 3
fix=1 last=0
while [ $# -gt 0 ]; do
  case $1 in --no-groupfix) fix=0 ;; --from-last) last=1 ;; --probe) probe=$2; shift ;; *) echo "unknown option $1" >&2; exit 2 ;; esac
  shift
done
IFS='|' read -r p12 pw prof <<< "$(identities "$ident")"
in=$b/$probe.ipa
[ $last = 0 ] || in=$b/last-$probe.ipa
out=$b/signed-$probe.ipa
case $signer in
  web)
    [ -f "$signers/tools/resignprobe/sign-web.mjs" ] || cp "$here/sign-web.mjs" "$signers/tools/resignprobe/"
    node "$signers/tools/resignprobe/sign-web.mjs" "$in" "$out" "$p12" "$pw" "$prof" $([ $fix = 1 ] || echo --no-groupfix) ;;
  native)
    openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -nocerts -nodes -out "$sec/key.pem" 2>/dev/null
    openssl pkcs12 -legacy -in "$p12" -passin "pass:$pw" -clcerts -nokeys 2>/dev/null | openssl x509 -outform der -out "$sec/cert.der"
    issuer=$(openssl x509 -inform der -in "$sec/cert.der" -noout -issuer)
    case $issuer in *G3*) wwdr=AppleWWDRCAG3 ;; *G6*) wwdr=AppleWWDRCAG6 ;; *G5*) wwdr=AppleWWDRCAG5 ;; *G4*) wwdr=AppleWWDRCAG4 ;; *) wwdr=AppleWWDRCAG3 ;; esac
    SIGNBENCH_KEY_PEM=$sec/key.pem SIGNBENCH_CHAIN=$repo/native/sign/certs/$wwdr.cer:$repo/native/sign/certs/AppleIncRootCertificate.cer \
      SIGNBENCH_GROUPFIX=$([ $fix = 1 ] && echo "$signers/web/app/vendor/groupfix/ifizbox-groupfix.dylib" || echo /nonexistent) \
      "$signers/native/sign/bench/build/signbench-linux" "$in" "$out" "$sec/cert.der" "$sec/cert.der" "$prof" | grep -v -E '^(STAGE|TOTAL|PEAK)|%$' ;;
  sidedrop)
    python3 -I - "$prof" "$sec/ents.plist" <<'EOF'
import plistlib, sys
d = open(sys.argv[1], "rb").read()
p = plistlib.loads(d[d.index(b"<?xml"):d.index(b"</plist>") + 8])
e = p["Entitlements"]
appid = e["application-identifier"]
if appid.endswith("*"):
    sys.exit("sidedrop signer: explicit App IDs only here")
e["keychain-access-groups"] = [appid]
e["get-task-allow"] = False
plistlib.dump(e, open(sys.argv[2], "wb"))
EOF
    (cd "$b" && "$rig/zsign" -q -z 1 -k "$p12" -p "$pw" -m "$prof" -e "$sec/ents.plist" -o "$out" "$in") ;;  # its .zsign_cache/ in build/
  *) echo "unknown signer $signer" >&2; exit 2 ;;
esac
rm -f "$sec/key.pem" "$sec/cert.der" "$sec/ents.plist"
step="$signer $ident$([ $fix = 1 ] || echo ' nofix')$([ $last = 0 ] || echo ' from-last') $probe"
id=$(unzip -p "$out" 'Payload/*.app/Info.plist' | python3 -I -c 'import plistlib,sys; print(plistlib.loads(sys.stdin.buffer.read())["CFBundleIdentifier"])')
if ! ui install "$out" --as-is; then
  echo "$step: INSTALL REFUSED: $(grep -i -E 'error|fail|mismatch|refus' "${XDG_RUNTIME_DIR:-/tmp}/ifizbox-15/ios.log" | tail -2)"
  echo "{\"step\": \"$step\", \"install\": \"refused\"}" >> "$b/log.jsonl"
  exit 3
fi
cp "$out" "$b/last-$probe.ipa"
launch "$id"
report "$id" x "$step"
