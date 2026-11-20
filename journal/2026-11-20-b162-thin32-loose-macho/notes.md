# B162: loose 32-bit-only Mach-O no longer fails the IPA

RetroArch 1.12.0's IPA has armv7-only cores in `modules/`; the on-device signer threw
`bad_macho: only 64-bit Mach-O files can be signed` and the whole IPA failed.

## What changed
- `MachO.has64BitCode` (native/sign/CodeSign.swift): a thin 64-bit Mach-O, or a fat one with a 64-bit slice.
- IPASigner's loose-Mach-O pass: a file with no 64-bit code is not signed; it stays the original zip entry, so
  the bundle's CodeResources seals it by hash like any resource (what zsign/Feather do). Each one is logged
  ("Skipped <path>: 32-bit only, iOS 15+ can't load it, sealed as a resource") and listed in `SignedApp.skipped`.
- Only loose files: a nested bundle whose own executable is 32-bit only still fails (`has no 64-bit code` /
  `only 64-bit`). The brief only covers loose dylibs; no such IPA is known.

## Tests
- `thin32.ipa` fixture (test_sign.py): rich_ipa plus a thin armv7 dylib, a fat armv7+armv7s dylib and an arm64 one in
  `modules/`. The Swift test checks skipped/log, the 32-bit files byte-identical, the arm64 core signed, all three
  sealed with the right hash, and `has64BitCode` on the fat/thin fixtures.
- `python3 -m unittest native/test_sign.py`: OK.

## Not verified
- The real RetroArch 1.12.0 IPA was not signed (not downloaded; an external 100+ MB fetch, and the fixture covers
  the same Mach-O shapes). Not installed on a phone either: whether iOS accepts the app with unsigned armv7 files
  sealed as resources is assumed from zsign/Feather doing the same.
