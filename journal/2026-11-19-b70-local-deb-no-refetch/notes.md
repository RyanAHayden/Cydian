# B70: install-deb installs the local file, not a source's copy

## Cause

When a local .deb has the same version and hash as a source's, apt merges the two into one version, and its
acquire step (pkgAcqArchive) can pick the source's file and download it. Before downloading, pkgAcqArchive looks
for `<Dir::Cache::Archives>/<name>` and, if the file there matches the expected hashes, uses it with no download.
The name is `QuoteString(Package,"_:")_QuoteString(Version,"_:")_QuoteString(Arch,"_:.").deb` (so an epoch
`1:1.0` becomes `1%3a1.0`, lowercase hex).

## What changed

`native/helper/paid.c`: after the root-owned copy is made (and checked for install-paid), installs (install-deb,
install-deb-ask, install-paid; not simulate-deb) run `seed_archive`: dpkg-deb -f reads Package, Version and
Architecture; each must be plain (helper_name_ok, helper_version_ok, arch `[a-z0-9-]+`, each field once); the copy
is written with O_EXCL|O_NOFOLLOW to `<prefix>/var/cache/apt/archives/<apt's name>`. After apt-get it is
removed. Best effort: no dpkg-deb answer, odd fields, no cache dir, or the name already taken (apt's own cached
file, which apt checks against the hashes itself and leaves alone here) mean nothing is placed and apt behaves as
before. The fork/exec tail of run_on_copy became `run_apt` so the cache entry is removed on every path.

No apt option prefers a local file over a merged source version, and hiding the sources (SourceList=/dev/null)
would break dependency resolution, so the cache route was taken.

main.c, policy.c and backend-native.js needed no change.

Test: `test_helper.LocalDeb.test_chain_seeds_archive` (seeded for install-deb and install-deb-ask, under the
quoted epoch name; untouched for simulate-deb, an unreadable control, a non-plain arch, a doubled field, and an
existing cache file; cache empty afterwards).

## Checked on the iPhone 7 (apt 2.9.4)

`Dir::Cache "var/jb/var/cache/apt"`, `archives/`: the path `<prefix>/var/cache/apt/archives` is right.
Download-only runs with a temp archive dir (`-o Dir::Cache::Archives=/tmp/b70/arch/`), using procursus' figlet
2.2.5 .deb as the "shell-fetched" file: with nothing there, `apt-get --download-only --reinstall install
/tmp/b70/copy.deb` printed `Get:1 https://apt.procurs.us … figlet 2.2.5`; with the copy placed as
`figlet_2.2.5_iphoneos-arm64.deb` it printed `Need to get 0 B/100 kB` and no Get: line. /tmp/b70 was removed.

## Not verified

- A full queue run in the app on the phone (the Log shows no Get: for a Downloaded row): it needs a new .deb
  build installed on the 7, which other slots overwrite, and a test source over the ssh -R tunnel; the apt-level
  check above is the same acquire path.
- A real (non download-only) install through the helper on the phone, and an epoch version's quoted name against
  real apt: no epoch package was at hand; the quoting follows apt's QuoteString and is covered by the unit test.
- A source that refuses apt (Havoc's 418): not tried; with the file seeded apt makes no request at all.
