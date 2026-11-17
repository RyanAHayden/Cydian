# DONE: finished tasks, newest last

### Web: browse and upgrade (in order)
- [x] **T1** Skeleton for the shared frontend (docs/native.md): `web/app/` (index.html, app.js, ES modules, no build step) with the tab bar (Home, Sources, Changes, Installed, Search), empty screens and client-side navigation (no page loads). `web/app.py` (Flask) serves `web/app/` plus `/healthz`. `web/requirements.txt` (flask, gunicorn, requests), `Dockerfile` + `compose.yaml` like sidedrop's (the image also gets `node` for F10/F11). Add `node --test web/app` to tools/check.sh. t: test_app.py gets 200 for `/`, the static files and `/healthz`; a node test for the router. | files: web/app/**, web/app.py, web/test_app.py, web/requirements.txt, Dockerfile, compose.yaml, tools/check.sh | test: web/test_app.py
