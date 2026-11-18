# F162: release Cydian 0.5.0

## What I did
- All the `after:` tasks (F154-F166 minus F162/F164) were on main at bf16170; F164 is not a dependency.
- Version: 0.5.0 (minor bump after v0.4.0, as the brief says).
- Notes: `release-notes.md` here, written from DONE.md's entries for every task merged since v0.4.0
  (F134-F166), short lines, the biggest change (Browse + Roulette) first since the alert shows the first 4 lines.
- `tools/release.sh --dry-run --notes …` first: built 0.5.0-973, deb and IPA checks passed, six assets listed.
- **Did not use `tools/publish.sh`** (the one-command path in docs/release.md): it needs `main` checked out and
  pushes `main` itself, and this run's rules forbid touching or pushing the main branch from a task worktree.
  Instead, on `task/F162`: committed `native/VERSION` = 0.5.0 + the notes, pushed `task/F162` (release.sh only
  requires HEAD to be on *some* origin branch, and `gh release create --target <sha>` tags that exact commit),
  then ran `tools/release.sh --notes …` with `GH_TOKEN=$(gh auth token -u RyanAHayden)` (the active gh account
  is FIZL0, which is what publish.sh does too). The runner merges task/F162 into main, so the tagged commit
  ends up on main's history.
- release.sh's own `altsource.py update` rewrote `web/app/source.json`; committed with the task.
- Published: https://github.com/RyanAHayden/Cydian/releases/tag/v0.5.0, tag at 677989b (the version commit on
  task/F162), build 0.5.0-974. Assets: Cydian.ipa, Cydian.deb, com.ryha.cydian_0.5.0-974_iphoneos-arm64.deb,
  Packages, Packages.gz, Release.
- Committed the AltStore source update (0.5.0 first in versions[], 0.2.0 dropped by the 20-version cap).

## Checks afterwards
- `releases/latest/download/Cydian.ipa` is 0.5.0 (CFBundleShortVersionString read from the download).
- `https://cydian.dev/repo/Packages` lists com.ryha.cydian 0.5.0-974; Release has `Components: main`.
- iPhone 7 (had 0.4.0-968): `apt-get update` on cydian.sources alone (with AllowInsecureRepositories, the repo is
  unsigned by design) → `apt-cache policy` Candidate 0.5.0-974.
- iPhone 7, in the app (UI lock F162; F167 had it for a minute first): Cydian relaunched → "Cydian 0.5.0 Is
  Available" alert with the first four note lines, Later / Install (`ref/7/screens/f162-launch.png`). Install →
  the app closed itself and dpkg shows `com.ryha.cydian 0.5.0-974` (`f162-install.png`); reopened, the
  installed Info.plist says 0.5.0 (974), Home shows the new Browse row and no update alert (`f162-after.png`).
- I hadn't planned for the active gh account being FIZL0. Using the owner's token (`gh auth token -u RyanAHayden`)
  fixed it before anything was published, so no attempt failed.

## Not verified
- The sideload IPA update path (the sideload app signing 0.5.0 on the phone and installing itself): no sideload
  build is installed on a test phone, and the brief only asks for the jailbreak check.
- The Changes tab's badge of 1 after the upgrade: I didn't check which package it counts. It came from the phone's
  other sources and isn't a Cydian upgrade, because the Essential Upgrade alert didn't come back.
- Phone left with Cydian 0.5.0-974 installed, since installing the upgrade was the test.
