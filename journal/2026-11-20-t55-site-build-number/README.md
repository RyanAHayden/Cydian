# T55: site build.json build number matches the release's apps

The release tag (release.sh --tag-source) sits on a commit that only adds web/app/source.json on top of the built
commit, so tools/deploy.sh's buildinfo run counted one commit more than the apps (v0.17.1: apps 2850, site 2851).

## What changed
- `tools/buildinfo.sh` takes `--rev REV` (default HEAD): the commit whose short hash and commit count go in
  build.json. The positional DIR still works (native/build.sh calls it that way); with no --rev nothing changes.
- `tools/deploy.sh`: when the tag commit has one parent and changes only web/app/source.json, it passes the parent
  as `--rev`. The file list still comes from the tag's worktree (so source.json is the tag's).
- Decision: the commit hash follows the build number too (both name the built commit), so the site's footer reads
  exactly like the app's "Version 0.17.1 (2850) · 9d3787ad". A tag that is anything else is counted as before.
- `tools/test_deploy.py`: a source.json-only tag gets the parent's count and hash; a normal tag keeps its own.

## Checked
- `python3 -m unittest tools.test_deploy.Deploy`: 8 pass.
- Against the real tag: `git diff --name-only v0.17.1^ v0.17.1` is only web/app/source.json and
  `tools/buildinfo.sh <tmp> --rev v0.17.1^` writes build 2850, commit 9d3787ad.

## Tried and failed
- Nothing failed. (Edits to the two scripts were first made with a python heredoc; later edits used the edit tool.)

## Not verified
- No real deploy: ifizbox.com/build.json still says 2851 until the next deploy (`tools/deploy.sh v0.17.1` would fix
  it now; publishing is outside this task).
