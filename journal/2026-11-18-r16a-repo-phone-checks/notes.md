# R16a: phone checks of cydian.dev/repo/ after the next release

## What I did
- `curl -s https://cydian.dev/repo/Release` (2026-11-18): Origin/Label/Suite/Codename/Architectures/Description/Date
  and hashes, but **no `Components:` line**. Release Date: Wed, 18 Nov 2026 09:26:28 GMT.
- `curl -s https://cydian.dev/repo/Packages`: `com.ryha.cydian` `0.3.8-731`.
- Newest git tag is `v0.3.8`; `tools/selfrepo.py` on main already writes `Components: main` (N11), it just has not
  been published by `tools/release.sh` since.

The task's precondition (a release newer than 0.3.8-791 is live, with Components) is not met, and publishing a
release is outside this task (agents never publish beyond git unless the task says so). So I did not touch the
iPhone 7: Sileo would still answer "Could not parse release file" and Zebra has nothing newer to upgrade to.

## Not verified
- Release shows Components live: not yet published.
- Sileo adds https://cydian.dev/repo/: needs the release above.
- Zebra adds the repo and upgrades Cydian from it: needs a newer version in the repo.
- `/var/jb/etc/apt/sources.list.d/cydian.sources` names https://cydian.dev/repo/ after that upgrade (B17 postinst):
  needs the Zebra upgrade.

Unblock: a person runs `tools/release.sh` (version > 0.3.8-791), then this task reopens.
