# B16: the daemon's automatic updates skip packages whose Filename is a full URL

N7's `auto_step` handed every chosen upgrade to `apt-get install --only-upgrade <ids>`. A package whose Filename is
a full URL (ios.jjolano.me's GitHub links) 404s there (F131's notes). The task offered two roads: skip them, or
download them as the app does.

## What I did

Skipped them (the smaller, safer road; decided without asking since the run is unattended). Downloading in the
daemon would mean a fetcher, an SSRF-style guard and an unchecked .deb run as root by a background job with nobody
watching; the app already installs them from the queue (F131) with a person confirming.

- `auto.c`: `auto_url_filename` (same rule as core/queue.js `isAbsoluteFilename`: `<scheme>://`), `auto_linked`
  (streams apt's `<lists>/*_Packages` with getline, one pass for a batch of id=version pairs, hit[] for those
  whose stanza has a full-URL Filename), `auto_plan_installs` (id=version of each `Inst` line, new packages too).
- `auto_step`: after the safe-id filter, the chosen upgrades' id=to pairs are looked up; linked ones are unchosen and
  logged ("... downloads from a link apt can't fetch: left for Cydian's queue"). Not a failure: no "failed" line, no
  notification; it stays in the count/badge so the user sees it in Changes. Then, after `apt-get -s install`, if the
  plan would install any linked package (a dependency of the rest), the batch is treated like a `Remv` plan:
  "Update Failed", `failed <id>=<to>` lines, so it isn't retried until a new version.
- `auto.h`: the three functions and `struct auto_env.lists_dir` (NULL: no lookup, the old behaviour). `main.m` sets it
  to `/var/jb/var/lib/apt/lists`. `auto_driver.c`: `lists/` in step's folder, and `linked`, `installs`, `url` verbs.
- `test_auto.py`: class `Linked` (URL rule, lists lookup including CRLF, mixed-case scheme, long names, files not
  ending `_Packages` ignored, missing dir) and four `Runs` tests (a linked upgrade skipped while the others install;
  only linked → nothing runs; a linked dependency → Update Failed; no lists → as before).
- README: a "Links apt can't fetch" bullet.

Nothing tried failed. One slip caught in review before testing: a fixed 16-byte buffer for Filename that would have
read long URLs as empty; replaced by looking at the value in place.

## Decisions

- A plan with only linked upgrades still leaves their `id=to` lines in the state, so `auto_state_waiting` stays true
  and each hourly start that may install re-plans (`apt-get -s`, offline, a few seconds) and installs nothing. Cheap;
  not worth a new state line.
- Compressed lists (`Acquire::GzipIndexes`, `*_Packages.lz4`/`.gz`) are not read: Procursus/palera1n's apt keeps them
  uncompressed. If a phone compressed them, the lookup finds nothing and the daemon behaves as before (apt 404s, an
  "Update Failed").

## Not verified

- On the iPhone 7: the task didn't ask to touch it, so no real run of `cydian-upgrades` against ios.jjolano.me's
  lists. Checked on Linux through auto_driver with Packages files shaped like that repo's.
- The arm64 iOS build of `auto.c`/`main.m` (`stage.sh`) wasn't run: no iOS SDK in this run's path checked. `auto.c`
  compiles clean with host clang and gcc (`-std=c11 -Wall -Wextra -Werror -pedantic`); `getline` exists on Darwin.
- How long the lists scan takes on a phone with large repos (BigBoss etc.): it only runs when there are upgrades to
  install automatically, one streaming pass per batch; not measured.
