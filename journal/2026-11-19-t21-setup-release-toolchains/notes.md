# T21: the setup command release's two missing builds (macOS SDK, llvm-mingw)

`tools/setup/release.sh --probe` said windows-arm64 was missing llvm-mingw and macOS was missing `MACOS_SDK`.

## Done

- `tools/setup/macos-sdk.sh FILE [DEST]` (`--full` for the whole SDK) gets the part of MacOSX.sdk that release.sh
  links against (`usr/lib`, `usr/include`, `SDKSettings.*`, and the CoreFoundation, Security, SystemConfiguration,
  CoreServices and IOKit frameworks) from:
  - a Command Line Tools **.pkg**: a xar product archive. It reads only the `*SDK*.pkg/Payload` members (pbzx, gzip or
    plain cpio). Each path is joined to the package's `PackageInfo` install-location, so the SDK is found whether
    the payload paths start at `/` or inside the SDK folder;
  - a CLT **.dmg**: 7z pulls out the largest .pkg first. A stdlib-only script can't read UDIF + HFS+/APFS, and 7z is
    on this machine;
  - an Xcode **.xip**: the `Content` pbzx stream. Only `.../SDKs/MacOSX*.sdk` matches, never iPhoneOS.
  When there are several SDKs, it keeps the newest by `SDKSettings.json` Version. A CLT pkg ships two (e.g. 14.5 and
  15.5), and Xcode's real folder is `MacOSX.sdk`, with the versioned name a symlink to it. It uses the same path
  guards as tools/ios-sdk.sh (no `..`, no writing through a symlink). The default DEST is
  `${XDG_DATA_HOME:-~/.local/share}/ifizbox/MacOSX.sdk`. It doesn't fix any .tbd stubs: F258 linked with a Mac's SDK
  as it was.
- `tools/setup/llvm-mingw.sh [DEST]` downloads llvm-mingw 20261117 (ucrt, ubuntu-22.04, for x86_64 or aarch64
  Linux hosts), checks it against a pinned SHA-256 (the digest GitHub lists for the asset, which matched my download)
  and unpacks it to `${XDG_DATA_HOME:-~/.local/share}/ifizbox/llvm-mingw` (about 620 MB).
- release.sh: when `MACOS_SDK` isn't set, it uses the default SDK folder if present. `LLVM_MINGW` (default: the
  folder above) gets its `bin/` added to the **end** of PATH, so llvm-mingw's own `clang` never takes the place of
  the system clang in the other builds. The probe's missing-tool messages now name the two scripts. `--help` printed
  4 lines of code after the header (`sed -n 2,29p` against a 25-line header). Fixed to stop at the comment.
- Tests: `tools/setup/test_macos_sdk.py` builds fixture archives byte by byte: a CLT-like .pkg with two SDK packages
  plus a tools package and zlib-encoded PackageInfo, pbzx and gzip payloads, a payload relative to the SDK folder, an
  Xcode-like .xip with newc cpio and an iPhoneOS SDK beside it, and a zip named .dmg (7z reads by content). It also
  covers `--full`, the default DEST, existing DEST, path traversal, a write through a symlink, not-an-archive and no
  SDK. Two more tests: release.sh `--probe` finds both default folders, and llvm-mingw.sh refuses an existing DEST.
- docs/sideload.md: the release paragraph now names both scripts.

## Checked

- With llvm-mingw unpacked into a gitignored scratch folder, `LLVM_MINGW=… tools/setup/release.sh --dry-run`
  built linux-x86_64, linux-arm64, windows-x64 and **windows-arm64** (a 1.9 MB `PE32+ … ARM64`), and install.ps1
  got its real SHA-256 in place of `none`. The toolchain was deleted afterwards. This machine has no default-folder
  copy, so `--probe` still reports llvm-mingw missing here until someone runs `tools/setup/llvm-mingw.sh`.

## Tried and failed

- My first llvm-mingw unpack went to the session scratchpad on /tmp (tmpfs). It filled the quota (EDQUOT). I deleted
  it and redid the unpack in the worktree's gitignored `tools/setup/target/` on /home.

## Not verified

- **macos-sdk.sh on a real Apple download.** Downloading the CLT .dmg or an Xcode .xip needs an Apple ID sign-in at
  developer.apple.com, which an unattended run can't do. The tests use fixtures shaped like the real archives as far
  as I know them: CLT `CLTools_macOSNMOS_SDK.pkg`/`CLTools_macOSLMOS_SDK.pkg` with pbzx Payloads, install-location
  `/Library/Developer/CommandLineTools`, and Xcode's `MacOSX.platform/Developer/SDKs`. To check it: run
  `tools/setup/macos-sdk.sh Command_Line_Tools_for_Xcode_*.dmg`, then `tools/setup/release.sh --dry-run`, and confirm
  the macOS build links.
- That 7z opens Apple's real CLT .dmg. It handles UDIF + HFS+ in general. Only a zip renamed to .dmg was tested.
- The windows-arm64 .exe was never run: there's no Windows on ARM machine here, and wine runs x64 only.
- The macOS binary still hasn't run on a Mac (as in F258). The MBA wasn't used.
