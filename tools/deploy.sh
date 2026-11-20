#!/usr/bin/env bash
# Deploys https://<domain> (the Worker, worker/wrangler.ifizbox.toml) from a release tag (docs/release.md):
#
#   tools/deploy.sh vX.Y.Z [--dry-run]
#   tools/deploy.sh --check-auth      is wrangler logged in, and stop
#
# tools/publish.sh runs it right after it tags a release; run it by hand to redeploy a tag (a rollback, or a deploy
# that failed). It checks the tag out in a clean temporary worktree, writes web/app/build.json there
# (tools/buildinfo.sh, naming the built commit under a source.json-only tag commit) and runs
# `npx wrangler deploy -c wrangler.ifizbox.toml` in its worker/, so nothing on disk here (untracked files, a branch's work) reaches the site. Needs wrangler logged in to the account that owns the
# Worker (`npx wrangler login`; `npx wrangler whoami` shows it). --dry-run builds the Worker (wrangler deploy
# --dry-run) and uploads nothing.
#   IFIZBOX_WRANGLER  the wrangler npm package to run (default wrangler@4.164.0)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
. native/brand.env # BRAND_DOMAIN
die() { echo "deploy: $*" >&2; exit 1; }

wrangler="${IFIZBOX_WRANGLER:-wrangler@4.164.0}"

# --check-auth: is wrangler logged in? (publish.sh asks before it pushes anything)
if [ "${1:-}" = --check-auth ]; then
  who=$(cd worker && npx --yes "$wrangler" whoami -c wrangler.ifizbox.toml 2>&1) || true
  grep -q 'You are logged in' <<<"$who" || die "wrangler isn't logged in: run 'cd worker && npx wrangler login'"
  echo "deploy: wrangler is logged in"
  exit 0
fi

tag="${1:-}"; shift || true
[[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: tools/deploy.sh vX.Y.Z [--dry-run] | --check-auth"
dry=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=(--dry-run); shift ;;
    *) die "unknown option $1" ;;
  esac
done

git fetch -q origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || true
sha=$(git rev-parse -q --verify "refs/tags/$tag^{commit}") || die "no tag $tag (here or on origin)"

tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/w" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
git worktree add -q --detach "$tmp/w" "$sha"
echo "deploy: $tag ($sha) to https://$BRAND_DOMAIN${dry:+ (dry run: nothing is uploaded)}"
# release.sh --tag-source tags the built commit plus a commit adding web/app/source.json: name the built commit in
# build.json, so the site shows the same build number and commit as the release's apps
built=$sha
if [ "$(git rev-list --parents -n 1 "$sha" | wc -w)" = 2 ] &&
   [ "$(git diff --name-only "$sha^" "$sha")" = web/app/source.json ]; then
  built=$(git rev-parse "$sha^")
fi
(cd "$tmp/w" && tools/buildinfo.sh --rev "$built")
(cd "$tmp/w/worker" && npx --yes "$wrangler" deploy -c wrangler.ifizbox.toml "${dry[@]}") ||
  die "wrangler deploy of $tag failed (logged in? npx wrangler whoami)"
if [ ${#dry[@]} = 0 ]; then echo "deploy: https://$BRAND_DOMAIN now runs $tag"
else echo "deploy: dry run done: https://$BRAND_DOMAIN would run $tag"; fi
