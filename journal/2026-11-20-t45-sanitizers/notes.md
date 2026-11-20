# T45: ASan + UBSan on the helper and daemon host tests

## What changed

- `native/helper/test_helper.py`: `probe_sanitizers()` builds and runs an empty program with
  `-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -g`. When that works, `build()` adds
  those flags to every helper/test_driver build (also for test_remove_malware, test_appversions, test_notify, test_udid
  and test_uninstall, which import `build`), and the module sets `ASAN_OPTIONS=detect_leaks=0:abort_on_error=1`
  and `UBSAN_OPTIONS=print_stacktrace=1` in its environment so every driver/helper run inherits them. When it doesn't,
  `SAN_FLAGS` is empty, the builds run as before, and `Sanitizers` is skipped with the reason.
- `native/daemon/test_auto.py`: the same probe (duplicated, small: the daemon dir can't import the helper's module
  without a sys.path hack), flags on the auto_driver build.
- Each file has a `Sanitizers.test_injected_overflow_caught`: a program with a heap overflow (helper also: stack
  overflow, signed int overflow) built with the same flags must die with a sanitizer report.

## Decisions

- Leak checking off: the helper and drivers exit without freeing; LSan would fail runs over nothing.
- GCC 16 with the sanitizers gives a false `-Wrestrict` on policy.c:351 (`snprintf` from `name_buf[i]` into
  `item_buf[i]`, two separate arrays; the plain build doesn't warn). The probe adds `-Wno-restrict` only when the
  compiler accepts it under `-Werror` (clang rejects the unknown option). policy.c is not this task's file, and the
  code is correct.
- The overflow test accepts UBSan's object-size report ("insufficient space") as well as ASan's: GCC's UBSan
  catches the store first.
- First int-overflow probe `return i + 1 > 0` was folded by -O1 into no check at all; stored into a volatile instead.

## Checks run

- Helper suite (test_helper + the five importers, 99 tests) passes under GCC and under `CC=clang`.
- test_auto (45 tests) passes under GCC and clang.
- Real injection: in a scratch copy of native/helper, a `memcpy` of the package name into `char b[16]` in
  `helper_name_ok` made `Helper.test_names` fail with `AddressSanitizer: stack-buffer-overflow`.

## Follow-up

- T52 (low): the same for native/daemon/test_daemon.py and test_quiet.py (out of this task's files).

## Not verified

- The skip path (a compiler without sanitizer runtimes): both compilers here have them; the code path is the probe's
  early return only.
