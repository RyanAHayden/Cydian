# T46: size guard for tracked files

## What
- `tools/test_sizeguard.py`: if a file git tracks, or would track (untracked and not ignored, because `done`
  commits those), is over 1 MB (1,048,576 bytes) and isn't allowed, the gate fails. It runs as a unittest from
  check.sh's discover loop and also as the first step of `tools/check.sh` (`--list`), so it fails in under a second
  instead of after the native builds.
- Allowed by pattern: `web/app/vendor/zsign/*`, `native/icon/*` (Assets.car, AssetsLite.car, 1024 px icons),
  `web/app/icons/*` and `plan/*.md`. `plan/DONE.md` is 725 KB and only grows, so without this the gate would
  start failing for every task in a few weeks.
- Grandfathered by exact path: the two F290 showcase MP4s (7.4 MB and 8.3 MB) and `journal/F1/trace.json.gz`
  (1.6 MB). A test fails once one of them is no longer tracked, so its name gets dropped from the list and can't
  be reused for a new big file.
- Tests: a fake 2 MB `journal/x/clip.mp4` in a temp git repo fails both untracked and committed. A 2 MB file in an
  ignored `ref/`, an allowed path, and a file of exactly 1 MB all pass. Allow patterns don't match lookalike paths
  under journal/. I also checked by hand: a real 2 MB `journal/fake-2mb.bin` in this worktree made `--list` exit 1
  and name the file. Then I deleted it.

## Sizes on 2026-11-20
Shared `.git`: 315 MB (`size-pack` 124 MB plus 178 MB of loose objects, which `git gc` would mostly pack).
Six tracked files are over 1 MB, all covered above. The biggest journal PNGs are just under 1 MB (~0.97–1.02 MB;
`f303-why-page/phone-home-and-why.png` is 1,019,975 bytes, under the limit).

## Taking the MP4s out of history: a decision for the user (not done)
- **Leave them (what this task does).** They cost about 15.7 MB in every clone, for ever. The guard stops it
  getting worse. No risk.
- **`git rm` them from the tip only.** This saves nothing in .git, because history still holds them. It only
  makes checkouts smaller. Not worth breaking links in the F290 journal.
- **Rewrite history** (`git filter-repo --path … --invert-paths`). This saves about 15.7 MB packed (MP4s don't
  compress), roughly 12% of the current pack. The cost: every commit hash after F290 changes (2026-11-20), so every
  open `task/*` branch, worktree s1…, the runner's merge and plan clones, and every other clone need a re-clone or
  a rebase onto the new main, plus a force-push to the remote. With agent-runner slots working all the time, this
  has to happen with the runner stopped. Better: wait until a quiet moment and do it together with any other
  cleanup, so the hashes change only once.
- Note: the loose objects (178 MB) are a bigger, free win. `git gc` in the main checkout packs them. It's not done
  here because it's the shared main repo, not this worktree.

## Not verified
- The full `tools/check.sh` is run by `done` in the background. I ran only the size guard and its tests by hand.
- I haven't checked how the guard behaves in a fresh clone without `ref/`. It doesn't need `ref/`, because ignored
  files are skipped anyway.
