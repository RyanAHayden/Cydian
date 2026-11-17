# T1: frontend skeleton

## What I did

- `web/app/`: `index.html`, `app.js` (entry), `router.js`, `screens/{home,sources,changes,installed,search}.js`
  (each exports `title` and `render(el, route)`), `style.css` (placeholder layout only; F1 owns the iOS 6 look).
- Routing is **hash-based** (`#/<tab>/<path…>`), decided because the same files run from the app bundle
  (file:// or a custom scheme in WKWebView), where History API paths don't map to files and a reload would 404.
  Hashes also need no server-side fallback route. Each tab keeps its own last path (iOS tab behaviour), and
  tapping the active tab pops it to its root (`selectTab`). `router.js` takes a window-like object, so it has no
  DOM dependency and is tested under node (`web/app/router.test.js`). Path segments are URI-encoded, so a repo
  URL can be one segment.
- Test files go next to the code as `*.test.js` (F2 already plans `web/app/core/apt.test.js`). They are served
  by Flask like everything else in `web/app/`; harmless.
- `web/app.py`: serves `/` (index.html), any file under `web/app/` (`send_from_directory`, which refuses
  traversal), forces `text/javascript` for `.js` (module scripts need a JS MIME type; some systems' mimetypes map
  `.js` oddly), and `/healthz` → `ok`.
- `web/test_app.py`: 200 + JS MIME for `/` and every static file, `/healthz`, 404 for missing files and `..`.
- `tools/check.sh`:
  - builds a per-checkout `.venv` from `web/requirements.txt` (with `uv` when present, else `python3 -m venv` +
    pip), rebuilt only when requirements change (stamp `.venv/.requirements`). System Python has no Flask here,
    and sidedrop does the same with a `.venv`. Added `.venv/` to `.gitignore` (one line, outside the file list but
    needed). The first gate run in a fresh worktree needs network for the install.
  - discovers tests **per directory** that holds a `test_*.py`: `web/` is not a package, so the old single
    discover from the root would never have found `web/test_app.py`.
  - runs `node --test web/app` (recursive; checked that a failing `web/app/core/*.test.js` fails the gate, and
    that a failing `test_*.py` does too).
- `Dockerfile` (python:3.13-slim + Debian `nodejs`, gunicorn gthread, uid 568, healthcheck on `/healthz`),
  `compose.yaml` (`.env` optional), `.dockerignore`. Same shape as sidedrop's, minus zsign and the data volume
  (nothing persistent yet; F3's cache/F10's subscribers will add one).

## Checked

- `tools/check.sh` passes (4 Python tests, 5 node tests).
- gunicorn serves `/`, `/app.js` (text/javascript), `/healthz`.
- Headless Chromium: `/#/sources/a%20b` renders title "Sources", the Sources tab active, path "a b"; screenshot
  at 390x844 shows the nav bar, empty Home screen and the five tabs.
- `docker compose config` is valid; `docker build` succeeds, the container answers 200 on `/`, `/router.js` and
  `/healthz`, and has node v20.19.2 (Debian's `nodejs`). Test image removed afterwards.

## Not verified

- Tapping tabs in a real browser / on a phone (only the router's logic is tested, under node with a fake window,
  plus one headless DOM dump of a deep link). Click handling in `app.js` has no automated test: it would need a
  browser test harness, which this repo doesn't have yet.
- `compose up` on the real host: not run (no deploy target defined yet; nothing to deploy to).
