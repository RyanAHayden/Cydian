# T34: publish.sh waits for the live site

## What changed

- `tools/publish.sh` no longer picks its own `GH_TOKEN` (`gh auth token -u` + `gh api user`). Instead, a real run
  calls `tools/release.sh --check-auth` up front: the same owner-token lookup and `gh api user` check, done
  before the version commit is pushed, so a missing login still stops the run early. The `release.sh` it runs later
  in the clean worktree takes the owner's token itself (no `GH_TOKEN` is exported any more, so it does its own
  lookup; a `GH_TOKEN` the user sets still wins, as before).
- Step 5 used to download `releases/latest/download/iFizBox.ipa` and read its version. `release.sh` has made the same
  check (redirect to this tag's asset) since T33, so step 5 now runs `tools/release.sh --verify-live $version`,
  which polls `https://<domain>/repo/source.json` and `/repo/Packages` until both list the release (15 min). On a
  timeout publish.sh fails and says to check the Workers Builds deploy and rerun `--verify-live`.
- `docs/release.md` "Cutting one" says so.

## Checks

- `bash -n tools/publish.sh`.
- `tools/release.sh --check-auth` on this machine: "publishing as RyanAHayden", exit 0.
- `--verify-live` itself is covered by `tools/test_release.py` (T33).

## Not verified

- A full `tools/publish.sh X.Y.Z` run: it cuts a real release (pushes to main, tags, uploads), which this task must
  not do; and it refuses to run off main, so it can't be tried from the worktree. Its dry run needs the iOS
  toolchain build and doesn't reach the changed steps (the auth check and step 5 are real-run only).
