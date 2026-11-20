#!/usr/bin/env bash
# Build, checksum and publish the free route's setup command (F258, tools/setup/cli) for every computer, from Linux.
#
#   tools/setup/release.sh --probe              which builds this machine can make, and what's missing for the rest
#   tools/setup/release.sh --dry-run [--out D]  build into D (default tools/setup/dist): the binaries, SHA256SUMS,
#                                               install.sh and install.ps1 with the binaries' SHA-256 written in
#   tools/setup/release.sh [--out D]            the same, then publish D's files as the assets of the GitHub release
#                                               tagged `setup` (a pre-release, never "latest", so the app's
#                                               self-update and the APT repo never see it), replacing its assets
#     --allow-missing   publish even when a required build couldn't be made (its install script line says so)
#
# The Worker serves those assets at https://$BRAND_DOMAIN/sign/setup.sh, /sign/setup.ps1 and /sign/setup/bin/<file>
# (worker/src/setup.js, SETUP_TAG). Run the publishing form only when a person asks for a release (docs/sideload.md).
#
# Builds (each skipped, and named by --probe, when its toolchain isn't here):
#   linux-x86_64   x86_64-unknown-linux-musl, static          clang
#   linux-arm64    aarch64-unknown-linux-musl, static         clang, rust-lld
#   windows-x64    x86_64-pc-windows-gnu                       x86_64-w64-mingw32-gcc
#   windows-arm64  aarch64-pc-windows-gnullvm (optional: Windows 11 on ARM runs the x64 build)
#                                                              aarch64-w64-mingw32-clang (llvm-mingw)
#   macos          universal: aarch64- + x86_64-apple-darwin   clang, ld64.lld (rustup's), llvm-lipo, MACOS_SDK
# MACOS_SDK: a MacOSX.sdk folder (usr/lib, usr/include and the CoreFoundation, Security, SystemConfiguration,
# CoreServices and IOKit frameworks are enough): tools/setup/macos-sdk.sh pulls them out of a Command Line Tools
# .dmg/.pkg or an Xcode .xip. Unset, ~/.local/share/ifizbox/MacOSX.sdk (its default DEST) when it's there.
# LLVM_MINGW: an llvm-mingw folder, its bin/ added to the end of PATH (tools/setup/llvm-mingw.sh fetches one);
# unset, ~/.local/share/ifizbox/llvm-mingw. (Both ~/.local/share are ${XDG_DATA_HOME:-~/.local/share}.)
# Each needs its Rust target (rustup target add …). The first build fetches crates and idevice (network).
#   IFIZBOX_RELEASE_REPO  owner/name to publish on (default native/brand.env BRAND_GITHUB_REPO)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
. "$root/native/brand.env"

mode=build out="$here/dist" allow_missing=0
while [ $# -gt 0 ]; do
  case $1 in
    --probe) mode=probe ;;
    --dry-run) mode=dry ;;
    --out) out=${2:?--out needs a directory}; shift ;;
    --allow-missing) allow_missing=1 ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "setup release: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
die() { echo "setup release: $*" >&2; exit 1; }

# T47: the release ships from this checkout, so stray files in web/app/ (untracked or ignored, a leftover .ipa) stop
# it, dry runs too; --probe only looks at toolchains. IFIZBOX_STRAY_ROOT: the checkout to look in instead (tests).
if [ "$mode" != probe ]; then
  "$root/tools/stray-check.sh" "${IFIZBOX_STRAY_ROOT:-$root}" || die "web/app/ has files git doesn't track (above); not releasing"
fi

bin=$(printf '%s' "$BRAND_NAME" | tr '[:upper:]' '[:lower:]')-setup
manifest="$here/cli/Cargo.toml"
targetdir="$here/cli/target"
sysroot=$(rustc --print sysroot 2>/dev/null || true)
lld64=${LD64_LLD:-$sysroot/lib/rustlib/x86_64-unknown-linux-gnu/bin/gcc-ld/ld64.lld}
[ -x "$lld64" ] || lld64=$(command -v ld64.lld || true)
data=${XDG_DATA_HOME:-$HOME/.local/share}/ifizbox
if [ -z "${MACOS_SDK:-}" ] && [ -d "$data/MacOSX.sdk/usr/lib" ]; then MACOS_SDK=$data/MacOSX.sdk; fi
llvm_mingw=${LLVM_MINGW:-$data/llvm-mingw}
# at the end, so its clang never stands in for the system's in the other builds
if [ -x "$llvm_mingw/bin/aarch64-w64-mingw32-clang" ]; then PATH=$PATH:$llvm_mingw/bin; fi
have_target() { rustup target list --installed 2>/dev/null | grep -qx "$1"; }

# why NAME can't be built here, or nothing
missing() {
  local m=()
  command -v cargo >/dev/null || m+=("cargo")
  case $1 in
    linux-x86_64) have_target x86_64-unknown-linux-musl || m+=("rustup target x86_64-unknown-linux-musl"); command -v clang >/dev/null || m+=(clang) ;;
    linux-arm64) have_target aarch64-unknown-linux-musl || m+=("rustup target aarch64-unknown-linux-musl"); command -v clang >/dev/null || m+=(clang) ;;
    windows-x64) have_target x86_64-pc-windows-gnu || m+=("rustup target x86_64-pc-windows-gnu"); command -v x86_64-w64-mingw32-gcc >/dev/null || m+=("x86_64-w64-mingw32-gcc (mingw-w64)") ;;
    windows-arm64) have_target aarch64-pc-windows-gnullvm || m+=("rustup target aarch64-pc-windows-gnullvm"); command -v aarch64-w64-mingw32-clang >/dev/null || m+=("aarch64-w64-mingw32-clang (llvm-mingw: tools/setup/llvm-mingw.sh, or LLVM_MINGW)") ;;
    macos)
      have_target aarch64-apple-darwin || m+=("rustup target aarch64-apple-darwin")
      have_target x86_64-apple-darwin || m+=("rustup target x86_64-apple-darwin")
      command -v clang >/dev/null || m+=(clang)
      command -v llvm-lipo >/dev/null || m+=(llvm-lipo)
      [ -n "$lld64" ] || m+=("ld64.lld (rustup's, or LD64_LLD)")
      [ -n "${MACOS_SDK:-}" ] && [ -d "${MACOS_SDK:-}/usr/lib" ] || m+=("MACOS_SDK (a MacOSX.sdk folder: tools/setup/macos-sdk.sh)") ;;
  esac
  [ ${#m[@]} -eq 0 ] || { local IFS=,; echo "${m[*]}"; }
}

BUILDS=(linux-x86_64 linux-arm64 windows-x64 windows-arm64 macos)
OPTIONAL=" windows-arm64 "
if [ "$mode" = probe ]; then
  rc=0
  for b in "${BUILDS[@]}"; do
    why=$(missing "$b")
    if [ -z "$why" ]; then echo "$b: can build"; else echo "$b: missing $why"; [[ $OPTIONAL == *" $b "* ]] || rc=1; fi
  done
  exit $rc
fi

cargo_build() { # TARGET [env...]
  local t=$1; shift
  env "$@" cargo build --locked --release --quiet --manifest-path "$manifest" --target "$t" --target-dir "$targetdir"
}

build() { # NAME -> the file in $out
  case $1 in
    linux-x86_64)
      cargo_build x86_64-unknown-linux-musl CC_x86_64_unknown_linux_musl=clang CFLAGS_x86_64_unknown_linux_musl=--target=x86_64-unknown-linux-musl
      cp "$targetdir/x86_64-unknown-linux-musl/release/$bin" "$out/$bin-linux-x86_64" ;;
    linux-arm64)
      cargo_build aarch64-unknown-linux-musl CC_aarch64_unknown_linux_musl=clang CFLAGS_aarch64_unknown_linux_musl=--target=aarch64-unknown-linux-musl \
        CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=rust-lld
      cp "$targetdir/aarch64-unknown-linux-musl/release/$bin" "$out/$bin-linux-arm64" ;;
    windows-x64)
      cargo_build x86_64-pc-windows-gnu
      cp "$targetdir/x86_64-pc-windows-gnu/release/$bin.exe" "$out/$bin-windows-x64.exe" ;;
    windows-arm64)
      cargo_build aarch64-pc-windows-gnullvm CC_aarch64_pc_windows_gnullvm=aarch64-w64-mingw32-clang \
        CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER=aarch64-w64-mingw32-clang
      cp "$targetdir/aarch64-pc-windows-gnullvm/release/$bin.exe" "$out/$bin-windows-arm64.exe" ;;
    macos)
      local sdk=$MACOS_SDK t arch min T
      for t in aarch64-apple-darwin x86_64-apple-darwin; do
        if [ $t = aarch64-apple-darwin ]; then arch=arm64 min=11.0; else arch=x86_64 min=10.15; fi
        T=$(echo "$t" | tr 'a-z-' 'A-Z_')
        # ld64.lld signs arm64 executables ad hoc, as macOS requires to run them
        cargo_build $t SDKROOT="$sdk" MACOSX_DEPLOYMENT_TARGET=$min "CC_${t//-/_}=clang" "AR_${t//-/_}=llvm-ar" \
          "CFLAGS_${t//-/_}=-target $arch-apple-macos$min -isysroot $sdk" "CARGO_TARGET_${T}_LINKER=clang" \
          "CARGO_TARGET_${T}_RUSTFLAGS=-C link-arg=-target -C link-arg=$arch-apple-macos$min -C link-arg=-fuse-ld=lld -C link-arg=--ld-path=$lld64 -C link-arg=-isysroot -C link-arg=$sdk"
      done
      llvm-lipo -create -output "$out/$bin-macos" "$targetdir/aarch64-apple-darwin/release/$bin" "$targetdir/x86_64-apple-darwin/release/$bin" ;;
  esac
}

mkdir -p "$out"
declare -A sum
lacking=()
for b in "${BUILDS[@]}"; do
  why=$(missing "$b")
  if [ -n "$why" ]; then
    echo "setup release: $b skipped: missing $why" >&2
    sum[$b]=none
    [[ $OPTIONAL == *" $b "* ]] || lacking+=("$b")
    continue
  fi
  echo "setup release: building $b" >&2
  build "$b"
  case $b in windows-*) f="$out/$bin-$b.exe" ;; *) f="$out/$bin-$b" ;; esac
  sum[$b]=$(sha256sum "$f" | cut -d' ' -f1)
done

fill() { # TEMPLATE OUT
  sed -e "s|@NAME@|$BRAND_NAME|g" -e "s|@DOMAIN@|$BRAND_DOMAIN|g" -e "s|@BIN@|$bin|g" \
      -e "s|@SHA_MACOS@|${sum[macos]}|g" -e "s|@SHA_LINUX_X86_64@|${sum[linux-x86_64]}|g" \
      -e "s|@SHA_LINUX_ARM64@|${sum[linux-arm64]}|g" -e "s|@SHA_WINDOWS_X64@|${sum[windows-x64]}|g" \
      -e "s|@SHA_WINDOWS_ARM64@|${sum[windows-arm64]}|g" "$1" > "$2"
  ! grep -n '@[A-Z0-9_]*@' "$2" || die "$2 still has a placeholder"
}
fill "$here/install.sh.in" "$out/install.sh"
fill "$here/install.ps1.in" "$out/install.ps1"
chmod +x "$out/install.sh"
(cd "$out" && find . -maxdepth 1 -type f -name "$bin-*" -printf '%f\n' | sort | xargs -r sha256sum > SHA256SUMS)
echo "setup release: in $out:" >&2
(cd "$out" && ls -l install.sh install.ps1 SHA256SUMS $(find . -maxdepth 1 -type f -name "$bin-*" -printf '%f\n' | sort)) >&2

[ "$mode" = build ] || { echo "setup release: dry run, nothing published" >&2; exit 0; }
[ ${#lacking[@]} -eq 0 ] || [ "$allow_missing" = 1 ] || die "not publishing without ${lacking[*]} (or pass --allow-missing)"
command -v gh >/dev/null || die "publishing needs the gh CLI"
repo=${IFIZBOX_RELEASE_REPO:-$BRAND_GITHUB_REPO}
files=("$out/install.sh" "$out/install.ps1" "$out/SHA256SUMS")
for f in "$out/$bin-"*; do files+=("$f"); done
notes="The $BRAND_NAME computer setup command (free Apple ID route). Run it with: curl -fsSL https://$BRAND_DOMAIN/sign/setup.sh | sh (macOS, Linux) or iwr -useb https://$BRAND_DOMAIN/sign/setup.ps1 | iex (Windows)."
if gh release view setup --repo "$repo" >/dev/null 2>&1; then
  # drop assets this release doesn't make any more, then replace the rest
  for a in $(gh release view setup --repo "$repo" --json assets --jq '.assets[].name'); do
    keep=0; for f in "${files[@]}"; do [ "$(basename "$f")" = "$a" ] && keep=1; done
    [ $keep = 1 ] || gh release delete-asset setup "$a" --repo "$repo" --yes
  done
  gh release upload setup "${files[@]}" --repo "$repo" --clobber
  gh release edit setup --repo "$repo" --prerelease --latest=false --notes "$notes"
else
  gh release create setup "${files[@]}" --repo "$repo" --title "$BRAND_NAME setup command" --notes "$notes" --prerelease --latest=false
fi
echo "setup release: published on $repo, tag setup" >&2
