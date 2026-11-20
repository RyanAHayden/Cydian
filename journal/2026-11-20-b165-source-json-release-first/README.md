# B165: /repo/source.json serves the latest release first

SideDrop kept showing the old iFizBox after a release: the Worker's `/repo/source.json` answered with the deployed
`web/app/source.json` (ASSETS) and read the release's `source.json` asset only when that copy was missing, so a new
version appeared only after the commit, the merge and a Workers Builds deploy.

## What I did

- `worker/src/index.js selfSource`: asks `releases/latest/download/source.json` (through `upstream`, so 429/5xx
  retries and the GITHUB_TOKEN API fallback still apply) first; when that throws or isn't 2xx it falls back to
  ASSETS `/source.json`; 404 only when neither answers. Headers unchanged (5-minute `Cache-Control`, CORS).
  `releases/latest/download/...` isn't `releaseFile`, so the edge doesn't keep it for a day: the 5 minutes hold.
- `worker/test.mjs`: the deployed copy lists 0.14.0, the release 0.15.0: the release wins and ASSETS isn't asked;
  GitHub throwing, 404 and 503 (after retries) each fall back to ASSETS; neither gives 404; the whole-Worker case
  now stubs `globalThis.fetch` (it would have reached the real GitHub now that GitHub is asked first); the
  `/api/fetch` own-URL case exercises the fallback.
- `docs/release.md`: asset table, AltStore source paragraph, step 6 and the "order matters" note (it said
  `--verify-live` could only pass after the push; now it passes once the release is up).
- `tools/release.sh`: comments and `--verify-live`'s failure hint (it pointed at the commit/push of source.json;
  now at the release being latest, then the deploy). T33/T34's live check itself polls both URLs and needed no
  logic change: it simply passes sooner.
- One-line stale comments describing the old order in `tools/altsource.py`, `web/app/core/essential.js` and
  `web/app/core/appoffer.js` (comments only).

Kept: `publish.sh` still commits `web/app/source.json`, so the fallback stays current.

## Not verified

- The live site: nothing deployed from this task, and the next release is what shows it working on
  ifizbox.com/SideDrop.
- `tools/publish.sh:76`'s comment ("push above serves this release at /repo/") is now loosely worded; left alone
  (not in this task's files, comment only).
