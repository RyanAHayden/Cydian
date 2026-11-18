# R16a: phone checks of cydian.dev/repo/ after the next release

## First pass (earlier on 2026-11-18): blocked
`https://cydian.dev/repo/Release` had no `Components:` line and Packages still served `0.3.8-731`; no release newer
than 0.3.8-791 was out, so the phone was not touched and the task waited for `tools/release.sh`.

## Second pass (2026-11-18, after 0.4.0 shipped): all four checks pass
- **Release has Components.** `curl -s https://cydian.dev/repo/Release` from the desktop and from the iPhone 7 both
  show `Components: main` (Date: Wed, 18 Nov 2026 13:04:56 GMT); Packages lists `com.ryha.cydian` `0.4.0-861`.
- **Sileo 2.5.1 adds it.** `uiopen sileo://source/https://cydian.dev/repo/` (with Sileo already open; from the home
  screen the first open did nothing) brought up Add Source prefilled; Add Source → the list shows **Cydian**,
  https://cydian.dev/repo/, 1 package, no "Could not parse release file" (`ref/7/screens/r16a-sileo-2.png`,
  `r16a-sileo-3.png`).
- **Zebra 1.1.36 adds it and upgrades Cydian.** Zebra installed from Procursus for the test
  (`apt-get install xyz.willy.zebra`). `zbra://sources/add/https://cydian.dev/repo/` → Add → source **Cydian**, no
  error (`r16a-zebra-3.png`). Packages: Available Upgrades shows Cydian 0.4.0-861 · Cydian (`r16a-zebra-4.png`),
  package page "0.4.0-861 (Installed Version: 0.3.8-791)", Source Cydian (`r16a-zebra-5.png`). Modify → Upgrade →
  queue → Confirm: downloaded and set up 0.4.0-861 over 0.3.8-791, "Finished!" (`r16a-zebra-9.png`).
  `dpkg-query -W com.ryha.cydian` → `0.4.0-861`; `launchctl list` still has `com.ryha.cydian.upgrades`.
- **B17 postinst rewrote the source.** After that upgrade `/var/jb/etc/apt/sources.list.d/cydian.sources` is
  ```
  Types: deb
  URIs: https://cydian.dev/repo/
  Suites: ./
  ```
  (before: `URIs: https://github.com/RyanAHayden/Cydian/releases/latest/download/`).

## Notes
- With cydian.dev/repo/ in both cydian.sources and Sileo's sileo.sources, apt prints "Target Packages … is
  configured multiple times" (warning only; Zebra's `apt-get remove` showed it). A user who adds the repo in Sileo
  by hand after the B17 rewrite gets the same harmless warning.
- Sileo rewrote sileo.sources from its in-memory list when the source was added, which brought back B17's stale
  `http://127.0.0.1:8797/repo/` stanza along with the new one.

## Phone left as found (except the Cydian upgrade)
Zebra removed with `/var/mobile/Library/Application Support/xyz.willy.Zebra`; `sileo.sources` restored from the
backup taken before the test (Havoc, Chariz, BigBoss only); `/tmp/r16a-*` removed; UI lock released. Cydian stays at
0.4.0-861 (the upgrade was the test) and cydian.sources keeps the rewritten cydian.dev URI. docs/iphone7.md still
says 0.3.8-791 is installed; it is outside this task's files (journal/** only), so it was not edited.

## Not verified
- Sileo may still hold the cydian.dev and 127.0.0.1 sources in memory until its next refresh, and could write them
  back to sileo.sources; not checked after the restore because that needs opening Sileo again and waiting for a save.
- Opening the upgraded Cydian 0.4.0 app itself: not part of this task's checks.
