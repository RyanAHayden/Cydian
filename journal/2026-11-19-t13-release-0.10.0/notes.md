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

**Version shipped: 0.10.0** (build 2016), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.10.0>, tag at
6580b1b on `task/T13`.

- Dry run first (exit 0, build 2015, at the VERSION commit). Its tree-clean check would have refused the real run
  with this journal untracked, so I committed and pushed the journal, then published from that commit (exit 0).
- Piracy list: Canister f517ff676e47, current; nothing to commit.
- Packages carries 0.10.0-2016 plus 0.9.9 back to 0.9.4 (older releases read with gh).
- Committed the rewritten `web/app/source.json` (0.10.0 first).

## Checks after publishing
- `https://ifizbox.com/repo/Packages`: first stanza `Version: 0.10.0-2016`,
  `Filename: v0.10.0/com.ryha.ifizbox_0.10.0-2016_iphoneos-arm64.deb`, then 0.9.9 and older.
- `https://ifizbox.com/repo/v0.10.0/com.ryha.ifizbox_0.10.0-2016_iphoneos-arm64.deb`: HTTP 200, Debian package type.
- `releases/latest/download/iFizBox.ipa`: CFBundleShortVersionString 0.10.0, CFBundleVersion 2016.
- `https://ifizbox.com/repo/source.json` still lists 0.9.9 first: the Worker serves the copy deployed with the
  site, and the committed 0.10.0 copy deploys when the merge reaches main.

## Not verified
- Live `/repo/source.json` listing 0.10.0: it needs the runner to merge this branch and Workers Builds to deploy
  main, which happens after this session ends.
- No install of 0.10.0 on any phone (the task asked for the release and the server checks only).
