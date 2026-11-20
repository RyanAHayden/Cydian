# F294: zstd and bzip2 .debs for tweak injection

`core/unpack.js` refused a .deb whose `data.tar` was `.zst` or `.bz2`. It now unpacks both, in plain JS (no
`DecompressionStream`, which an iOS 15 web view lacks, and which has neither format anyway).

## What was done

- `unzstd(bytes, limit)`: RFC 8878 frames. Raw, RLE and compressed blocks; literals raw, RLE, Huffman (1 or 4
  streams, weights direct or FSE-coded) and treeless (the previous block's table); sequences with predefined, RLE,
  described and repeated FSE tables; the three repeat offsets; frames and skippable frames in a row. The frame
  content size is checked when the header has one. Refused: frames that need a dictionary, reserved bits and block
  types. The optional XXH64 checksum is skipped, not checked (like gunzip, which skips the CRC-32): a 64-bit hash
  would need BigInt or split 32-bit math for little gain, since tar and the Mach-O reader catch garbage.
- `bunzip2(bytes, limit)`: streams in a row (pbzip2), several blocks per stream, Huffman groups and selectors,
  MTF/RUNA/RUNB, inverse BWT, the RLE1 runs; each block's CRC is checked. Randomised blocks (bzip2 0.9.0) are refused.
- Both honour the output `limit` like the other decoders (a bomb stops there); `decompress()` sends `.zst`/`.zstd`
  and `.bz2` to them.
- Fixtures (`fixtures/tweaks/make.py`): `tweak-zst.deb` is now real zstd (level 19, checksum), new `tweak-bz2.deb`
  (rootless `usr/lib/TweakInject` + `usr/lib`), `payload.zst` (two frames: level 3, level 19 + checksum) and
  `payload.bz2` (two streams, the first spanning two 100 KB blocks). zstd needs Python 3.14 (`compression.zstd`);
  the docstring says its bytes follow Python's libzstd version (1.5.7 here), so `--check` can differ elsewhere.
- Tests (`core/tweaks.test.js`): the payloads against the same text built in JS, limits, not-this-format errors,
  damage (bzip2's CRC makes every flip throw; zstd flips must throw `UnpackError` or return bounded output, never
  hang or crash, and most throw), the two new .debs through `unpackDeb` and `prepareTweaks`, and a round-trip over
  node's own `zlib.zstdCompressSync` (levels 1-22, empty, 1 byte, RLE, random, text), skipped when node lacks zstd.
- docs/signing.md: the .deb line lists the new formats.

A scratch round-trip (84 cases: node zstd at 5 levels × checksum on/off, Python bz2 at levels 1 and 9, over empty,
1-byte, RLE, random, 300 KB and 1 MB inputs) passed on the first run; the whole set decodes in under a second.

## Tried and failed

Nothing failed. (One slip: I edited unpack.js's header comment through a Python heredoc instead of the edit tool.)

## Not verified

- On an iOS 15 web view (iPhone 7): not run there. The code uses only typed arrays, `Math.clz32` and `**`, all in
  Safari 15, like the existing xz decoder; the task touches no device.
- zstd streams with a dictionary, or from encoders other than libzstd 1.5.7 (node 26's and Python 3.14's): no
  such fixtures; dictionaries are refused with words.
- A real .zst/.bz2 tweak from a repo: none fetched (the run has no network task); the fixtures are built like
  dpkg-deb's.
