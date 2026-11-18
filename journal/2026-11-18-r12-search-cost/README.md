# R12: search cost per keystroke

## What I did
- Downloaded the default sources on 2026-11-18. APT: Telesphoreo, BigBoss, Chariz, Havoc and Procursus (Packages
  .xz/.bz2, decompressed). AltStore: the 11 defaults in `DEFAULT_ALT_SOURCES`. They went to the session scratchpad
  and were not committed (16 MB, third-party data).
- `bench.mjs` loads them into the real `createCatalog()` (`load` for APT, `loadAlt` with `detectJson`'s format for
  AltStore). It then times `c.search(prefix)` for every prefix of "snowboard", "youtube", "music player", "theme",
  "cydia" and "a": 39 keystrokes, 15 runs each, median and max.
  - `iphoneos-arm64` (the app's `DEFAULT_ARCH`) gives 2,614 rows. BigBoss has only 38 arm64 packages, and
    Telesphoreo's ios/1800.00 has no arm64 index (I read its arm one).
  - `both` loads each APT source for arm and for arm64, as two sources: 12,919 rows after merging, the heaviest
    load the defaults can give.

## Results (desktop node 26, Ryzen 7 9800X3D)
| Load | Rows | Median keystroke | Worst median (one letter) | Worst single run |
| --- | --- | --- | --- | --- |
| arm64 | 2,614 | 0.24 ms | 0.76 ms | 1.6 ms |
| both | 12,919 | 1.25 ms | 4.33 ms | 7.0 ms (16.7 ms once on the first run: JIT warm-up) |

Queries of two or more letters cost 0.9–1.7 ms at 12,919 rows. One-letter queries cost 3.4–4.3 ms, mostly in
sorting 2000+ hits.

## Decision
Every keystroke is under ~16 ms, even on the heaviest load, so **I did not file the narrowing cache**. The cost
sits in the one-letter case, and F101 already includes the single-Latin-character skip. I noted these numbers on
F101 (`plan note`), because its new tie-breaks run inside that sort. The findings are in `docs/sileo-zebra.md`
under "Search cost, measured (R12)".

## Tried and dropped
- On the 4S, the app's ES-module worker can't run in iOS 6 Safari. I started an ES5 port of the scan loop (a page
  plus a worker, served to the phone over an `ssh -R` tunnel, because the LAN port was blocked). Mid-run, another
  session passed on the user's scope change: the 4S is a reference device only and never runs Cydian (the main
  checkout's AGENTS.md now says so). I stopped the server and tunnel, sent the phone to the home screen and released
  the UI lock. No 4S result was ever collected, and I deleted the ES5 files and the one screenshot.

## Not verified
- **A real iPhone:** not timed. The brief allowed a modern iPhone only "if you have one". The iPhone 7 test phone
  is touched only when a task says so, and this task named only the 4S, which is now off limits. An A10-class phone
  runs JS a few times slower than this desktop. A rough guess of 4x puts the heaviest load at ~5 ms per keystroke and
  ~17 ms for a one-letter query. That is an estimate, not a measurement, and the one-letter case goes away with F101.
- **Worker overhead:** `postMessage` structured-clone of up to 2000 slim rows back to the UI is not included. It is
  outside `catalog.search` and isn't affected by the narrowing cache.
- **Real use:** the timings cover the loaded catalog with no filters, no hidden sections and Works on My Phone off.
  Filters only skip rows after the word test, so they don't make the scan slower.
