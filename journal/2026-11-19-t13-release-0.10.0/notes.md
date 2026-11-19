# T13: release 0.10.0

## What I did
- Checked that everything T13 waited on is ticked (F15, F264, F251, F254, F258, F268) and that the branch had
  every commit on origin/main.
- `tools/publish.sh` works only on main and pushes `native/VERSION` and `source.json` to main. This session may
  not push main, so I ran its steps by hand on `task/T13` instead: bumped `native/VERSION` to 0.10.0, committed
  it, pushed `task/T13` (so `release.sh` sees HEAD on origin), then ran `tools/release.sh` at that commit. The tag
  points at a commit on `task/T13`; it becomes part of main when the runner merges the branch.
- Checked that the app's version compare reads 0.10.0 as newer than 0.9.9 (`isNewer("0.10.0","0.9.9")` is true:
  numbers, not strings).
- Notes written by hand (the app shows the first line in Changes), kept in the scratchpad, not committed.
- The gh account active on this machine is not the repo owner, so `release.sh` ran with the owner's token
  (`GH_TOKEN=$(gh auth token -u RyanAHayden)`), as `publish.sh` does.
- Worker: no manual deploy. Workers Builds deploys `wrangler.ifizbox.toml` on every push to main
  (worker/README.md), so the committed `web/app/source.json` goes live when the runner pushes the merge.
- R28 was already ticked (done after 0.9.9), so there was nothing to unblock.
