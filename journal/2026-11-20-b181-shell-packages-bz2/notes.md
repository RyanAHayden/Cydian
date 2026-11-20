# B181: net.packages reads Packages.bz2 and sees through blank lines before HTML

## What changed

- `native/Sources/Apt.swift`: net.packages tries `Packages.xz`, `Packages.bz2`, `Packages.gz`, `Packages`, the
  site proxy's order (backend-http.js). `decompress` hands `.bz2` to `PackagesIndex.bunzip2` and asks
  `PackagesIndex.looksLikeHTML` about a plain index instead of looking at the first byte only.
- `native/Sources/PackagesIndex.swift` (new): the two checks, Foundation + libbz2 only, so they build on Linux.
  - `looksLikeHTML`: skips a UTF-8 BOM and ASCII whitespace in the first 4 KB; "<" there means a web page.
  - `bunzip2`: libbz2's streaming API in 64 KB chunks; concatenated streams (pbzip2) are joined, trailing
    non-"BZh" bytes after a stream end are ignored, a truncated or damaged file gives nil (so the next name is tried).
- `native/Sources/iFizBox-Bridging-Header.h`: `#include <bzlib.h>`; `native/build.sh`: `-lbz2` beside `-lz`
  (the iOS SDK ships libbz2.tbd and bzlib.h; libbz2 is part of iOS).
- `native/test_packages_index.py` + `native/tests/packagesindex/`: builds PackagesIndex.swift with the host swiftc
  and libbz2, runs it on fixtures written with Python's bz2 (single, concatenated, zero-padded, truncated, damaged,
  >64 KB), the HTML cases (blank lines, BOM, "<" inside an index), and checks the Apt.swift / build wiring as text.

The task listed Apt.swift only; the bridging header, build.sh link flag and the new file were needed to call libbz2
and to test it off the phone.

web/app/backend-native.js keeps B177's JS fallback (.bz2/.zst and the HTML re-check): still right for .zst and for
older shells. Its comments ("the shell tries Packages.xz, .gz and plain only") are now out of date; not touched,
since the file isn't this task's.

## Tried

- Nothing failed. (First edit put the helpers inside Apt.swift; moved them to their own file so a host test can
  build them, as test_urlencode.py does for URLEncode.swift.)

## Verified

- `python3 -m unittest test_packages_index` passes (Swift part ran with the host toolchain).
- `native/build.sh deb` builds with the change; `llvm-objdump --dylibs-used build/iFizBox` lists
  `/usr/lib/libbz2.1.0.dylib` (a system library on iOS, so nothing to bundle).

## Not verified

- Not run on the iPhone 7: the task doesn't call for touching the phone, and other slots overwrite its .deb. So
  BigBoss refreshed through the shell (not the JS fallback) on a device is unchecked; the same code path is tested
  on Linux against libbz2 1.0.8, the version the iOS SDK's libbz2.1.0.8.tbd names.
- The sideload executable is linked by the same `build.sh deb` run (both `link()` calls run), but the .ipa wasn't
  packaged by me; the gate's native build does that.
