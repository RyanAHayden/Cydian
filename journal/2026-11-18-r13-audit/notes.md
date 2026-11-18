# R13 repo audit

What was removed, merged and left (and why) is in `docs/audit.md`; each step is its own `R13 …` commit.

## What I did
- Baseline `tools/check.sh` first: green, native build included (Swift toolchain present on this machine).
- Scripts (kept out of the repo) for unused exports, duplicate function bodies, unreferenced files, unused CSS
  classes, unused Python/Swift functions; every hit checked by hand before removing.
- `node --test web/app` after each JS step (883 tests at the end: 2 removed with their dead code, F37's
  sideloaderLink test and mode.js's tabsFor test; launch.js's notification-tap test went with `?launch=push`).

## Tried and backed out / corrected
- The unreferenced-file scan flagged `icon-lite-glossy-152/228.png`; home.js builds them into a srcset, so they
  stay.
- First draft of worker/README.md said the website uploads to `/sign/host`; it is `/sign/upload` (fixed before
  commit).
- The first liveHUD merge left an orphan comment in signing-client.js; removed in its own commit.

## Behaviour notes
- launch.js no longer strips `?launch=push` from a URL or keeps that page on a standalone launch. Nothing has
  produced that mark since sw.js went (F89), so no real launch changes.
- test_daemon lost `test_same_words_as_the_server`: it compared with web/push.py, which is gone, so it had skipped
  on every run.

## Not verified
- Nothing ran on a phone (the iPhone 7 or the 4S): the task changes no user-facing behaviour and doesn't ask for
  it. The changed screens (anything importing `el`, `liveHUD`, `barButton`) were checked by the node tests only.
- Speed: no product timing was measured (no device in this task); see docs/audit.md "Left on purpose".
