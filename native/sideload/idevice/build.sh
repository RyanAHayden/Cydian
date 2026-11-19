#!/usr/bin/env bash
# Build idevice (github.com/jkcoxson/idevice, MIT) from source for the phone: libidevice_ffi.a and idevice.h for
# arm64-apple-ios15.0, the "no server" install route (README.md beside this script). Upstream's IDevice.xcframework
# is a binary download made on a Mac; this builds the same static library on Linux from a pinned commit, so the
# corresponding source is that commit and nothing else.
#
#   build.sh            fetch the pinned commit and build it (once per user, in ~/.cache/ifizbox/idevice, or
#                       IFIZBOX_IDEVICE_CACHE), then copy the library into native/build/idevice/{lib,include}
#   build.sh --probe    exit 0 if cargo, the aarch64-apple-ios target, clang, ld64.lld and IOS_SDK are all there,
#                       else say what's missing and exit 3
#
# Needs: rustup's aarch64-apple-ios target (`rustup target add aarch64-apple-ios`), clang, IOS_SDK (as build.sh),
# ld64.lld (rustup's gcc-ld one by default, or LD64_LLD), and network for the first fetch (git + crates.io).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/pin.env" # IDEVICE_REPO, IDEVICE_COMMIT, IDEVICE_FEATURES
out=$here/../../build/idevice

missing=()
command -v cargo >/dev/null || missing+=("cargo")
command -v clang >/dev/null || missing+=("clang")
if command -v rustup >/dev/null; then
  rustup target list --installed 2>/dev/null | grep -qx aarch64-apple-ios ||
    missing+=("the aarch64-apple-ios Rust target (rustup target add aarch64-apple-ios)")
else
  missing+=("rustup")
fi
sdk=${IOS_SDK:-}
[ -n "$sdk" ] && [ -d "$sdk" ] || missing+=("IOS_SDK (an iPhoneOS.sdk directory)")
lld=${LD64_LLD:-$(rustc --print sysroot 2>/dev/null || true)/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld" ] || lld=$(command -v ld64.lld || true)
[ -n "$lld" ] || missing+=("ld64.lld (rustup's, or set LD64_LLD)")
if [ ${#missing[@]} -gt 0 ]; then
  printf 'idevice build: missing %s\n' "${missing[@]}" >&2
  exit 3
fi
[ "${1:-}" = --probe ] && exit 0

# Our changes on top of the pinned commit (MIT, like idevice; patches/*.patch, applied in order): part of the stamp,
# so editing one rebuilds. The corresponding source is the pinned commit plus these patches.
patches=$(cat "$here"/patches/*.patch 2>/dev/null | sha256sum | cut -c1-16)

# Built already from this pin (commit, features, patches): nothing to do. native/build.sh calls this on every build.
stamp="$IDEVICE_COMMIT $IDEVICE_FEATURES $patches"
if [ -f "$out/lib/libidevice_ffi.a" ] && [ "$(cat "$out/stamp" 2>/dev/null)" = "$stamp" ] &&
  cmp -s "$here/module.modulemap" "$out/include/module.modulemap"; then
  exit 0
fi

# The source and cargo's target/ (~700 MB) live in one per-user cache shared by every checkout and worktree, under a
# lock: each worktree's native/build only gets a copy of the finished library.
cache=${IFIZBOX_IDEVICE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/ifizbox/idevice}
built=$cache/built/$(printf '%s' "$stamp" | sha256sum | cut -c1-16)
src=$cache/src
mkdir -p "$cache" "$out"
exec 9>"$cache/lock"
flock 9
if [ ! -f "$built/libidevice_ffi.a" ]; then
  if [ ! -d "$src/.git" ]; then
    git clone --filter=blob:none "$IDEVICE_REPO" "$src"
  fi
  if [ "$(git -C "$src" rev-parse HEAD)" != "$IDEVICE_COMMIT" ]; then
    git -C "$src" fetch --filter=blob:none origin "$IDEVICE_COMMIT" 2>/dev/null || git -C "$src" fetch origin
    git -C "$src" checkout -q --detach "$IDEVICE_COMMIT"
  fi
  # The pinned tree, clean (an earlier build may have left patches or a regenerated idevice.h), then our patches.
  git -C "$src" checkout -q -f --detach "$IDEVICE_COMMIT"
  for p in "$here"/patches/*.patch; do
    [ -f "$p" ] && git -C "$src" apply "$p"
  done
  # The crates build dylibs too (plist_ffi and idevice-ffi are cdylib as well as staticlib), so cargo needs a
  # linker that can make an iOS Mach-O: clang driving lld against the SDK, as native/build.sh links the app.
  export SDKROOT=$sdk IPHONEOS_DEPLOYMENT_TARGET=15.0
  export CC_aarch64_apple_ios=clang AR_aarch64_apple_ios=${AR:-llvm-ar}
  command -v "$AR_aarch64_apple_ios" >/dev/null || unset AR_aarch64_apple_ios
  export CFLAGS_aarch64_apple_ios="-target arm64-apple-ios15.0 -isysroot $sdk"
  export CARGO_TARGET_AARCH64_APPLE_IOS_LINKER=clang
  export CARGO_TARGET_AARCH64_APPLE_IOS_RUSTFLAGS="-C link-arg=-fuse-ld=lld -C link-arg=--ld-path=$lld -C link-arg=-isysroot -C link-arg=$sdk"
  export BINDGEN_EXTRA_CLANG_ARGS="--sysroot=$sdk"
  (cd "$src/ffi" && cargo build --locked --release --target aarch64-apple-ios --no-default-features \
    --features "$IDEVICE_FEATURES")
  # The library goes in last: its presence says the rest is there.
  mkdir -p "$built"
  cp "$src/ffi/idevice.h" "$src/LICENSE.txt" "$built/"
  cat "$here"/patches/*.patch > "$built/patches.diff" 2>/dev/null || true
  git -C "$src" describe --tags --always > "$built/version"
  cp "$src/target/aarch64-apple-ios/release/libidevice_ffi.a" "$built/libidevice_ffi.a.part"
  mv "$built/libidevice_ffi.a.part" "$built/libidevice_ffi.a"
fi
flock -u 9

mkdir -p "$out/lib" "$out/include"
cp "$built/libidevice_ffi.a" "$out/lib/libidevice_ffi.a"
cp "$built/idevice.h" "$out/include/idevice.h"
cp "$here/module.modulemap" "$out/include/module.modulemap"
cp "$built/LICENSE.txt" "$out/LICENSE-idevice.txt"
printf '%s' "$stamp" > "$out/stamp"
echo "idevice: $out/lib/libidevice_ffi.a ($(cat "$built/version"))"
