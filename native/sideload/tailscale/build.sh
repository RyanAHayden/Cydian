#!/usr/bin/env bash
# Build the Tailscale part of the "This iPhone" install route (README.md beside this script): tsnet.go, a Go
# c-archive embedding tailscale.com's tsnet (BSD-3-Clause), for arm64-apple-ios, linked into the sideload app only.
# Go and the module versions are pinned: Go by pin.env's version and sha256, the modules by go.mod + go.sum.
#
#   build.sh            build native/build/tailscale/{libtsnet.a,libtsnet.h} once per pin (Go, go.mod, go.sum,
#                       tsnet.go), cached per user in ~/.cache/ifizbox/tailscale (or IFIZBOX_TAILSCALE_CACHE)
#   build.sh --probe    exit 0 if clang, curl and IOS_SDK are there, else say what's missing and exit 3
#
# Needs: clang, IOS_SDK (as native/build.sh), and network for the first build (Go's tarball, the modules).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/pin.env" # GO_VERSION, GO_SHA256
out=$here/../../build/tailscale

missing=()
command -v clang >/dev/null || missing+=("clang")
command -v curl >/dev/null || missing+=("curl")
sdk=${IOS_SDK:-}
[ -n "$sdk" ] && [ -d "$sdk" ] || missing+=("IOS_SDK (an iPhoneOS.sdk directory)")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'tailscale build: missing %s\n' "${missing[@]}" >&2
  exit 3
fi
[ "${1:-}" = --probe ] && exit 0

stamp="$GO_VERSION $(cat "$here/go.mod" "$here/go.sum" "$here/tsnet.go" | sha256sum | cut -c1-16)"
if [ -f "$out/libtsnet.a" ] && [ "$(cat "$out/stamp" 2>/dev/null)" = "$stamp" ]; then
  exit 0
fi

cache=${IFIZBOX_TAILSCALE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/ifizbox/tailscale}
built=$cache/built/$(printf '%s' "$stamp" | sha256sum | cut -c1-16)
mkdir -p "$cache" "$out"
exec 9>"$cache/lock"
flock 9
goroot=$cache/$GO_VERSION/go
if [ ! -x "$goroot/bin/go" ]; then
  tgz=$cache/$GO_VERSION.linux-amd64.tar.gz
  curl -fsSL -o "$tgz.part" "https://go.dev/dl/$GO_VERSION.linux-amd64.tar.gz"
  echo "$GO_SHA256  $tgz.part" | sha256sum -c --quiet
  rm -rf "$cache/$GO_VERSION" && mkdir -p "$cache/$GO_VERSION"
  tar -xzf "$tgz.part" -C "$cache/$GO_VERSION"
  rm -f "$tgz.part"
fi
if [ ! -f "$built/libtsnet.a" ]; then
  # The compiler for cgo: clang against the iOS SDK (a wrapper, since CC can't carry spaces safely everywhere).
  cc=$cache/ioscc.sh
  printf '#!/bin/sh\nexec clang -target arm64-apple-ios15.0 -isysroot "$IOS_SDK" -Wno-unused-command-line-argument "$@"\n' > "$cc"
  chmod +x "$cc"
  work=$cache/work && rm -rf "$work" && mkdir -p "$work" && cp "$here/go.mod" "$here/go.sum" "$here/tsnet.go" "$work/"
  mkdir -p "$built"
  (cd "$work" && env -u GOFLAGS PATH="$goroot/bin:$PATH" GOROOT="$goroot" GOPATH="$cache/gopath" \
    GOMODCACHE="$cache/gopath/pkg/mod" GOCACHE="$cache/gocache" GOTOOLCHAIN=local GOTELEMETRY=off GOFLAGS=-mod=readonly \
    GOOS=ios GOARCH=arm64 CGO_ENABLED=1 CC="$cc" IOS_SDK="$sdk" \
    go build -trimpath -ldflags="-s -w" -buildmode=c-archive -o "$built/libtsnet.a.part" .)
  mv "$built/libtsnet.a.h" "$built/libtsnet.h" # go names the header after the output, minus its last extension
  ts=$(awk '{for (i = 1; i < NF; i++) if ($i == "tailscale.com") print $(i + 1)}' "$work/go.mod")
  cp "$cache/gopath/pkg/mod/tailscale.com@$ts/LICENSE" "$built/LICENSE-tailscale.txt"
  echo "$GO_VERSION tailscale.com $ts" > "$built/version"
  mv "$built/libtsnet.a.part" "$built/libtsnet.a"
fi
flock -u 9

cp "$built/libtsnet.a" "$out/libtsnet.a"
cp "$built/libtsnet.h" "$out/libtsnet.h"
cp "$built/LICENSE-tailscale.txt" "$out/LICENSE-tailscale.txt"
printf '%s' "$stamp" > "$out/stamp"
echo "tailscale: $out/libtsnet.a ($(cat "$built/version"))"
