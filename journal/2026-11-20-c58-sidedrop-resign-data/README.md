# C58 SideDrop: re-signed apps keep their data — handed to SideDrop's own B23

## What I did

- Read the brief: give SideDrop (separate repo, live server) the B227 data fixes: per-app keychain group,
  the group fix dylib, a "keep your apps' data" doc section; "needs the user's go-ahead".
- Found that SideDrop already has this exact work queued in its own plan as **B23**, filed by the user
  (2026-11-20, "RyukGram/Instagram loses imported settings…", with "deploy.sh to the TrueNAS box after merge"),
  blocked only until iFizBox's fix landed on iFizBox main ("Reopen when iFizBox main has the B211 fix dylib").
  B211 and B227 are both on iFizBox main now, so that wait is over.
- Decision: do not write SideDrop's code from an iFizBox slot. SideDrop has its own runner and slots
  (`~/runs/sidedrop/s1`, `s2`, …); a second copy of the same change made here would race B23 on `app.py` and
  would deploy outside SideDrop's own gate. B23 is the user's go-ahead for SideDrop work, in SideDrop's queue.
- In SideDrop's plan (`run plan` from `~/repos/sidedrop`, which commits to its plan):
  - `plan unblock B23` with a note carrying what C58 adds over B23's text: the keychain finding
    (`keychain-access-groups = [f'{team}.{kept bundle ID}', appid]`, own group first, not `[appid]`), where
    iFizBox's group fix lives (`native/groupfix/groupfix.m`, built copy in `web/app/vendor/groupfix/`,
    `ifizbox-groupfix.plist` with target `''`), the docs section for `docs/developer-account.md`, and the
    `tools/resignprobe` check with the matrix rows to compare.
  - `plan edit B23 --files` adds `docs/developer-account.md` to its files (a first edit also added `static/**`
    by mistake; the second edit removed it).

## Not verified

- Nothing in SideDrop was built, signed or deployed by this task: that is B23's work in SideDrop's run.
- The resignprobe "SideDrop signer" row after the fix: B23 runs it (needs the iPhone 15 Pro and SideDrop's
  identity), not this task.
