# T3: Cydian's own iOS SDK setup

## Done
- `tools/ios-sdk.sh Xcode.xip [DEST]`: written from scratch. It's a bash front end with the work in stdlib Python
  (`python3 -I -c`), so it needs no xar, pbzx or cpio binaries. The steps all stream, so Xcode's ~40 GB never touches the disk:
  xar TOC (zlib XML) → the stored `Content` member → pbzx chunks (xz or stored) → cpio (odc, plus newc) → only
  `Xcode*.app/.../iPhoneOS.platform/Developer/SDKs/*` is written to a temp dir next to DEST. Then the real
  `iPhoneOS<ver>.sdk` dir (not the `iPhoneOS.sdk` symlink) is renamed to DEST.
- The .tbd fix: in every `[ ... ]` list holding `arm64e.x1-<os>`, that becomes `arm64-<os>`, or is dropped when
  `arm64-<os>` is already there. `tools/ios-sdk.sh fix-tbd SDK` runs only this step on an SDK that's already
  extracted. Running it twice changes nothing the second time.
- Safety: archive paths with `..` or a leading `/` are refused, and so are writes through a symlink that leaves the
  output. DEST must not exist yet. The default DEST is `${XDG_DATA_HOME:-~/.local/share}/cydian/iPhoneOS.sdk`, which is ours.
- `native/spike/build.sh`: no default SDK path any more (it was `~/.local/share/hst-ios/...`, another
  project's folder). When `$IOS_SDK` is unset it exits 1 and says how to make an SDK with `tools/ios-sdk.sh`.
  This file isn't on T3's file list, but the brief asks for exactly this change, and it's 8 lines.
- `tools/test_ios_sdk.py` (9 tests): it builds a fixture .xip byte by byte (xar + pbzx with one stored and several xz
  chunks + odc cpio with dirs, files and symlinks, plus a non-SDK entry). It checks the extraction, the tbd fix,
  the default DEST, refusal of an existing DEST, traversal and symlink escapes, non-xar input, `fix-tbd` and that
  running it twice changes nothing. It also checks that build.sh fails clearly with `IOS_SDK` unset.
- Smoke test: `fix-tbd` on a copy of the real (already fixed) Xcode 27.1 SDK's `usr/` (379 stubs) changed 0 files.

## Not verified
- **A real Xcode .xip:** none is on this machine, and getting one needs an Apple ID login. The fixture follows the
  formats as documented (xar header/TOC, pbzx chunk framing, odc cpio), but Apple's real archive hasn't been run
  through the script. In particular, hard links: odc repeats the data for each link, so they should come out as copies.
- **The .tbd fix on unfixed Xcode 27 stubs:** the SDK here was already fixed by another tool. The rule
  (`arm64e.x1-<os>` → `arm64-<os>`) comes from docs/native.md. TAPI v5 JSON stubs (`"target": "arm64e.x1-ios"`)
  wouldn't be touched. None were seen in this SDK (all `tbd-version: 4`).
- **A full native build with an SDK from this script:** needs the real .xip, see the first point.
