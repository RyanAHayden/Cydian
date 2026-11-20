#!/usr/bin/env bash
# llvm-mingw for tools/setup/release.sh's windows-arm64 build (aarch64-w64-mingw32-clang): fetch a pinned release,
# check its SHA-256 and unpack it where release.sh looks.
#
#   tools/setup/llvm-mingw.sh [DEST]   default ${XDG_DATA_HOME:-~/.local/share}/ifizbox/llvm-mingw (about 620 MB)
#
# release.sh puts $LLVM_MINGW/bin on PATH (LLVM_MINGW defaults to the same folder), so nothing else is needed.
# From https://github.com/mstorsjo/llvm-mingw (Linux x86_64 and aarch64 hosts). To move to a newer release, change
# VERSION and both SHA-256s (each asset's digest is on the release page).
set -euo pipefail
VERSION=20261117
SHA_X86_64=e7a15a49a2ea95e9f3d8a9d0cfabe5052a4b10fb4777cc54de5a8c27b64bb701
SHA_AARCH64=6d9442ead9ace3b3e4c3389bfef69f93f873305e0705e6cc60978ac895320872

case ${1:-} in -h|--help) sed -n '2,9s/^# \{0,1\}//p' "$0"; exit 0 ;; esac
dest=${1:-${XDG_DATA_HOME:-$HOME/.local/share}/ifizbox/llvm-mingw}
die() { echo "llvm-mingw.sh: $*" >&2; exit 1; }
case $(uname -sm) in
  "Linux x86_64") host=x86_64 sha=$SHA_X86_64 ;;
  "Linux aarch64") host=aarch64 sha=$SHA_AARCH64 ;;
  *) die "no pinned llvm-mingw for $(uname -sm)" ;;
esac
if [ -e "$dest" ] || [ -L "$dest" ]; then die "$dest exists; remove it or give another DEST"; fi
name=llvm-mingw-$VERSION-ucrt-ubuntu-22.04-$host
mkdir -p "$(dirname "$dest")"
work=$(mktemp -d "$(dirname "$dest")/.llvm-mingw-XXXXXX")
trap 'rm -rf "$work"' EXIT
echo "llvm-mingw.sh: fetching $name" >&2
curl -fL --proto '=https' -o "$work/$name.tar.xz" "https://github.com/mstorsjo/llvm-mingw/releases/download/$VERSION/$name.tar.xz"
echo "$sha  $work/$name.tar.xz" | sha256sum -c --quiet - || die "$name.tar.xz doesn't match its pinned SHA-256"
tar -xJf "$work/$name.tar.xz" -C "$work"
[ -x "$work/$name/bin/aarch64-w64-mingw32-clang" ] || die "$name has no bin/aarch64-w64-mingw32-clang"
mv "$work/$name" "$dest"
echo "llvm-mingw.sh: $dest ($("$dest/bin/aarch64-w64-mingw32-clang" --version | head -n 1))"
