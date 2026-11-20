# R41: why sideload installs took so long, and the fixes

## How it was measured

The sideload build can't run on the iPhone 7 (it's the jailbreak test phone, and `signing.*` is refused in the
jailbreak build), so I built the on-phone signer itself (`native/sign/*.swift`, unchanged) into a command-line tool,
`native/sign/bench/` (`build.sh` builds it for the phone or for Linux, `fixtures.py` makes a throwaway key, cert and
wildcard profile). It signs a real IPA with a Security-framework RSA key as the app's KeychainIdentity does, under a
separate bundle ID (`com.ryha.r41bench`), and prints each stage's time and the peak memory (ru_maxrss). Nothing was
installed on the phone, and tiny-ifizbox.ipa wasn't used. The screen wasn't needed, so no ui-7.sh lock was taken.

Stages: **open** (the zip's directory), **reading** (inflate + SHA-1/SHA-256 of every file, for CodeResources),
**signing** (each Mach-O read again, signed, CodeResources), **writing** (the new zip).

IPAs (public, from the SideStore community source and GitHub):

| IPA | packed | unpacked | Mach-O |
|---|---|---|---|
| OldOS 1.0_18 | 88 MB | 148 MB | 2 (12 MB main binary, MailCore) |
| RAsmall: RetroArch 1.12.0 without mame and assets.zip | 130 MB | 495 MB | 128 dylibs (emulator cores) |
| RA64: RetroArch 1.12.0 without its 5 armv7 cores | 435 MB | 1.03 GB | 129, one of them 305 MB (mame) |

RA64 drops 5 armv7-only dylibs because the signer refuses the whole IPA over them (filed as B17). I had no X IPA (no
legitimate public download); RetroArch has the same shape (big binaries, many Mach-Os), only bigger.

Download on the phone (curl, Wi-Fi): 435 MB in 7.3 s, 88 MB in 2.6 s. Download isn't where the time goes.

## Before (main at 420d71d1), iPhone 7

| IPA | open | reading | signing | writing | total | peak memory |
|---|---|---|---|---|---|---|
| OldOS | 0.02 | 0.68 | 0.09 | 1.03 | **1.82 s** | – |
| RAsmall | 0.02 | 2.26 | 4.79 | 18.76 | **25.83 s** | 589 MB |
| RA64 | | | | | **killed by iOS** (jetsam, vm-pageshortage at 1.76 GB) | 1757 MB |

## What was slow, and why

1. **Re-deflating signed binaries at zlib level 6.** `ZipWriter.add` deflated every signed Mach-O at level 6 on one
   core. Measured on the A10 (`signbench --codec`): level 6 runs at 12.5 MB/s, level 1 at 27.5 MB/s, level 9 at
   6.5 MB/s; SHA-1+SHA-256 runs at 130–650 MB/s, CRC-32 at 1.5 GB/s. Writing RAsmall was 18.8 of its 25.8 s.
2. **Memory that never came back.** `FileHandle.readData` returns autoreleased data, and the signer runs as one long
   block on a GCD queue that never drains a pool, so every 1 MB piece of the IPA read (three passes: reading,
   signing, copying) stayed in memory until signing ended. On top of that, every signed binary stayed in memory until
   the write, and signing one copied it (copy-on-write in `signThin`, `[UInt8](input)` in deflate). That's the
   1.76 GB that got RA64 killed. In the app, memory pressure like that also slows everything around it.
3. **Copies per page.** `signThin` made a `Data` for every 4 KB page it hashed (`subdata`), and `Inflater.feed`
   copied each 1 MB input piece into an array first.
4. **Two RSA signatures per binary.** The CMS size was found by signing a dummy CodeDirectory before the real one.
   Through the Keychain that's an RSA signature for nothing, per binary.
5. **One core.** Reading, signing and deflating all ran on one thread; the A10 has two fast cores.
6. Smaller: the write loop looked up each folder entry with `kept.first(where:)` (quadratic in the entry count).

Not slow: the WebView bridge (the native path hands native a URL; the IPA never crosses as base64, and progress
events are throttled to whole percents), the JS run (core/apprun.js already signs two apps ahead while installing
one, so it's unchanged), and hashing (once per file; signed binaries' hashes are now taken once while they're in
memory instead of once per enclosing bundle).

## The fixes (native/sign/)

- `Zip.swift`: reads in an autorelease pool each (no-op shim on Linux); `Inflater`/`Deflater` give zlib the bytes
  in place; a streaming `Deflater`; `deflateBlocks`, 4 MB blocks deflated side by side with `Z_FULL_FLUSH` between
  them, joined into one raw deflate stream (pigz's trick; CRC-checked by unzip/zipfile in the tests); `ZipWriter.add`
  takes a `level` (0 stores) and a file (stored, or already deflated: copied as it is); `ZipReader.clone()` for
  parallel readers.
- `IPASigner.swift`: `level` (default 1) and `readers` (cores, up to 4). The reading pass runs on `readers`
  threads, biggest files first, progress per 4 MB from the calling thread only (the callers' closures expect it). A
  bundle's loose Mach-Os are signed side by side (`parallel`). A signed binary over 1 MB is deflated in blocks and kept
  in a file under `.<output>.parts/` (removed at the end) with its CRC and, if sealed, its hashes. Big binaries are
  read with room for the signature, so appending it doesn't move them. Folders are found through a dictionary.
- `CodeSign.swift`: pages hashed in place; the CMS reserve measured once per certificate and signing time
  (`CMS.reserve`); `sign`/`signThin` take the binary `__owned` and callers `consume` it, so a big binary isn't held
  twice while it's signed.
- `Hash.swift`: SHA-1/SHA-256 over raw buffers.
- `native/Sources/Sideload.swift`: `signer.level = 6` when the IPA goes to the server (`servers.host`: iFizBox's own
  update, under the Worker's 25 MB `/sign/host` cap). Everything else uses level 1.

Why level 1 and not store (0) for the loopback route: stored was only ~0.5 s faster on RAsmall (6.6 vs 7.1 s), makes
the IPA 3.5x bigger (492 vs 142 MB) on disk, through AFC on the This iPhone route (16.8 MB/s measured over Tailscale
in F264), and in My IPAs' kept signed copies. Also, the loopback route's freeze fallback uploads that same file to
`/sign/host`, which takes at most 25 MB.

## After, iPhone 7 (same IPAs, level 1 unless noted)

| IPA | open | reading | signing | writing | total | peak memory |
|---|---|---|---|---|---|---|
| OldOS | 0.04 | 0.42 | 0.23 | 0.24 | **0.93 s** (was 1.82) | 31 MB |
| RAsmall | 0.05 | 1.17 | 5.20 | 0.70 | **7.12 s** (was 25.83) | 135 MB (was 589) |
| RAsmall, level 0 (stored) | 0.05 | 1.13 | 2.72 | 2.68 | 6.58 s | 94 MB |
| RAsmall, level 6 | 0.04 | 1.15 | 10.96 | 1.28 | 13.43 s | 131 MB |
| RAsmall, 1 reader | 0.18 | 2.60 | 7.99 | 0.65 | 11.42 s | 129 MB |
| RA64 | 0.06 | 2.21 | 8.24 | 2.56 | **13.08 s** (was killed) | 490 MB |
| RA64, level 6 | 0.05 | 2.24 | 18.04 | 3.03 | 23.36 s | 536 MB |

IPA sizes at level 1: RAsmall 141.7 MB (130 at level 6), RA64 455 MB (434 at level 6), OldOS 87.9 MB (87.4).

Steps on the way (RAsmall, total / peak): before 25.8 s / 589 MB; level 1 + parallel read + spill 15.7 s / 596 MB
(the spill didn't help memory until...); autorelease pools 13.0 s / 85 MB; block deflate 10.2 s / 129 MB; loose
binaries in parallel 7.1 s / 135 MB.

## Tried and dropped

- Streaming deflate of a spilled binary while writing the zip (header patched afterwards): replaced by deflating in
  blocks at spill time, which uses both cores; the streaming `Deflater` stayed (deflateData uses it).
- `consuming` parameters on `MachO.sign`: they forbid implicit copies, and `file.prefix(8)` counted as a second
  consume. `__owned` gives the same hand-over.
- The first phone run of the bench: plain `ldid -S` gave a binary the phone killed at once (exit 137); it needs
  `platform-application` (bench/entitlements.plist).
- The first RA64 run over plain ssh: the jetsam kill also took the ssh session down. Run long benches detached
  (`nohup … &`) and read the log after.

## Follow-ups

- B17 (filed): a 32-bit-only loose dylib fails the whole IPA (RetroArch's armv7 cores).
- Bundles at the same depth (an app's frameworks) are still signed one after another; only a bundle's loose
  binaries go side by side. For an X-like app whose code is in a few big frameworks, parallel bundles would help
  more. Not filed: measure it on such an app first.

## Not verified

- **The sideload app itself on a phone.** Timings come from the bench, which runs the same signer sources but not
  the app (no WebView, no URLSession download, no install). The iPhone 7 can't run the sideload build, and no other
  phone was reachable for this task.
- **Install stage (handing the IPA to installd, AFC copy, iOS's install).** Not measured: the bench's signatures
  don't install (throwaway certificate), and the phone has no LocalDevVPN/idevice route. Level 1 makes the IPA ~10%
  bigger than level 6 (RAsmall 141.7 vs 129.0 MB), so the AFC copy takes ~10% longer; at F264's 16.8 MB/s that's
  under 1 s here, against ~6 s saved signing.
- **An X IPA.** Not available; RetroArch stands in for it.
- **The browser path (zsign WebAssembly on the site).** Not touched or timed: separate code (`web/app/vendor/zsign`).
- **Two signings at once** (the IPA queue signs two apps ahead): each now uses both cores; memory then is up to two
  big binaries per signing. Not measured together.
