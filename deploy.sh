#!/usr/bin/env bash
# Cydian deploy: run from a cron job on the server, inside a clone kept only for deploying.
# Every run: fetch origin/main. If it moved (or with --force, or when the container isn't running), check it out,
# rebuild and restart with docker compose, then wait for /healthz. If the new build doesn't come up healthy, go
# back to the commit that was running and rebuild that one. If nothing changed, exit quietly so cron mails nothing.
#
#   ./deploy.sh            deploy if origin/main moved
#   ./deploy.sh --force    rebuild and restart even if nothing moved
#   ./deploy.sh --status   say what's running and whether an update is waiting; change nothing
#
# Environment: CYDIAN_BRANCH (main), CYDIAN_HEALTH_URL (http://127.0.0.1:$CYDIAN_PORT/healthz, port from .env, 8080),
# CYDIAN_HEALTH_WAIT seconds (90). Settings for the app itself go in .env next to compose.yaml (see README.md).
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

BRANCH=${CYDIAN_BRANCH:-main}
PORT=$(sed -n 's/^CYDIAN_PORT=//p' .env 2>/dev/null | tail -1)
HEALTH_URL=${CYDIAN_HEALTH_URL:-http://127.0.0.1:${PORT:-8080}/healthz}
HEALTH_WAIT=${CYDIAN_HEALTH_WAIT:-90}
PROJECT=cydian

mode=deploy
case "${1:-}" in
  "") ;;
  --force) mode=force ;;
  --status) mode=status ;;
  *) echo "usage: $0 [--force|--status]" >&2; exit 2 ;;
esac

log() { echo "deploy: $(date '+%F %T') $*"; }
compose() { docker compose -p "$PROJECT" "$@"; }

# One deploy at a time: a slow build must not overlap the next cron tick.
exec 9>.deploy.lock
if ! flock -n 9; then
  [ "$mode" = status ] || log "another deploy is running; skipping"
  exit 0
fi

running() { [ -n "$(compose ps -q --status running 2>/dev/null)" ]; }

healthy() {
  local deadline=$((SECONDS + HEALTH_WAIT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

build_and_start() {
  compose build --pull && compose up -d --remove-orphans && healthy
}

git fetch -q origin "$BRANCH"
here=$(git rev-parse HEAD)
there=$(git rev-parse FETCH_HEAD)

if [ "$mode" = status ]; then
  echo "running commit: $(git log -1 --format='%h %s' "$here")"
  [ "$here" = "$there" ] && echo "up to date with origin/$BRANCH" ||
    echo "waiting: $(git log -1 --format='%h %s' "$there") ($(git rev-list --count "$here..$there") commits)"
  running && echo "container: running" || echo "container: not running"
  [ -s .deploy.failed ] && echo "last failed deploy: $(cut -c1-7 .deploy.failed) (skipped until main moves or --force)"
  grep -qs '^CYDIAN_PROXY_HOPS=[1-9]' .env || echo "warning: CYDIAN_PROXY_HOPS is not set in .env"
  exit 0
fi

if [ "$mode" = deploy ] && running; then
  [ "$here" = "$there" ] && exit 0
  # A commit that already failed here is not retried every tick (one cron mail, not one per tick); a new
  # commit on main or --force tries again.
  [ "$there" = "$(cat .deploy.failed 2>/dev/null)" ] && exit 0
fi

# This clone is for deploying only; local edits would be lost by the checkout below, so stop and say so.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "local changes in $(pwd); refusing to deploy over them:"
  git status --short --untracked-files=no
  exit 1
fi

grep -qs '^CYDIAN_PROXY_HOPS=[1-9]' .env ||
  log "warning: CYDIAN_PROXY_HOPS is not set in .env; behind the proxy every visitor shares one rate limit"

log "deploying $(git log -1 --format='%h %s' "$there") (was ${here:0:7})"
git checkout -q --detach "$there"
if build_and_start; then
  rm -f .deploy.failed
  docker image prune -f >/dev/null || true
  log "healthy at ${there:0:7}"
  exit 0
fi

echo "$there" >.deploy.failed
log "${there:0:7} failed its health check; logs:"
compose logs --tail 40 || true
if [ "$here" != "$there" ]; then
  log "rolling back to ${here:0:7}"
  git checkout -q --detach "$here"
  if build_and_start; then
    log "rolled back; ${here:0:7} is healthy"
  else
    log "rollback to ${here:0:7} is not healthy either"
  fi
fi
exit 1
