# T53: deploy ifizbox.com on release tags, not on every push to main

Done under the owner's change of plan: no GitHub Action and no repo secret. wrangler is logged in on this machine
(OAuth), so `tools/publish.sh` deploys the site itself, from the tag.

## What changed

- **`tools/deploy.sh vX.Y.Z [--dry-run]`** (new): checks the tag out in a temporary worktree, runs
  `tools/buildinfo.sh` there and `npx --yes wrangler@4.164.0 deploy -c wrangler.ifizbox.toml` in its `worker/`.
  Nothing on disk in the checkout (untracked files, newer main) reaches the site. `--check-auth` greps
  `wrangler whoami` for "You are logged in". `IFIZBOX_WRANGLER` overrides the pinned package (4.164.0 is what the
  npx cache here already had; pinned so a release doesn't pull a brand-new wrangler mid-publish).
- **`tools/release.sh --tag-source`** (new option): in a real run, just before `gh release create`, it copies the
  updated source.json into `web/app/source.json`, commits it on top of the built HEAD, tags that commit and pushes
  the tag only. `gh release create` then uses the existing tag. If it fails the tag is deleted again (remote and
  local). A dry run prints what it would do. Without the flag nothing changed.
- **`tools/publish.sh`**: checks wrangler's login in step 1 (before the version commit is pushed), passes
  `--tag-source` in step 3, and step 4 is now: pull main, `git merge` the tag (fast-forward when main didn't move,
  else a merge commit), push main, `tools/deploy.sh vX.Y.Z`. Step 5's `--verify-live` is unchanged. Dry run says
  what it would merge and deploy.
- Docs: README.md, worker/README.md, worker/wrangler.ifizbox.toml's header and docs/release.md ("Deploying the site"
  section) say deploys happen on release tags; release.sh's live-check failure points at `tools/deploy.sh`.

## Why this shape (decided, unattended)

The source.json can't simply be in the version commit: it names the IPA built from that commit (size, date, notes),
so it only exists after the build. Options were: tag main's later source.json commit (would tag code merged by the
runner meanwhile, not what was built), or deploy from main at tag time (the owner asked for "the tagged commit").
So the tag goes on *built commit + source.json only*, and main merges the tag. Merging (not a separate copy of the
commit) keeps the tag in main's history, so the next release's `git describe` notes start from it. The IPA/deb are
built from the tag's parent: the only difference is source.json, which the builds already carried one release
behind before this change.

## Tests

`tools/test_deploy.py` (in the gate):
- Deploy (fake `npx` on PATH, throwaway repo): deploys the tagged commit from a removed temp worktree, build.json
  names the tag's commit and leaves out an untracked file, dry run passes `--dry-run`, wrangler failure, missing tag,
  bad usage, `--check-auth` both ways.
- TagSource: a *real* `release.sh --tag-source --draft` run in a throwaway repo with a bare origin, fake gh, saved
  Canister answers and the last native build from native/build/: the tag sits on the built commit + source.json only,
  it's pushed, source.json names the new version's tag URL, main on origin is untouched, `gh release create` targets
  the tagged commit. Skipped where there is no native build (the gate builds one first where the toolchain is).

Also run by hand: `tools/deploy.sh v0.17.0 --dry-run` with the real wrangler: built the Worker with all bindings,
"--dry-run: exiting now", nothing uploaded. `tools/deploy.sh --check-auth` against the real login: logged in.
`tools/publish.sh 0.99.0 --dry-run` in a scratch clone (branch named main, origin = itself, since this worktree
can't check out main): full native build, exit 0, ends with "a real run would commit web/app/source.json on top of
… and tag that commit v0.99.0" and "a real run would merge v0.99.0 into main, push it and deploy https://ifizbox.com".

## Failed / tried

- First deploy.sh had `doesn't` inside `${dry:+...}` in a double-quoted string: bash read the apostrophe as a quote.
  The tests caught it.

## Manual step for the owner

1. **Turn off Workers Builds' push deploy** for the `ifizbox` Worker in the Cloudflare dashboard (Workers & Pages >
   ifizbox > Settings > Build: disconnect the repo or stop builds on main). Until then every push to main still
   deploys, as before; nothing else breaks. wrangler's OAuth token can't do it (the task brief: "Authentication
   error" on the Workers Builds API, checked 2026-11-20). Not attempted here.

No GitHub secret is needed.

## Not verified

- A real `tools/publish.sh` release (tag push, gh release, merge into main, real deploy): only a person may start a
  release, and it publishes. Covered instead by the TagSource test and a real wrangler dry run.
- A real (non-dry) `tools/deploy.sh`: it would deploy production from a tag; not done from a task.
- The exact dashboard path for turning off Workers Builds: from memory of Cloudflare's UI, not looked at.
- actionlint: no workflow was added (owner's change of plan), so nothing to lint.
