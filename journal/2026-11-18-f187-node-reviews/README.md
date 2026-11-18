# F187: worker/node.mjs keeps F182 reviews

## Done
- `worker/node.mjs`: `env.REVIEWS = d1(REVIEWS_DB)` from `src/d1-sqlite.js` (node:sqlite), default `reviews.db`
  (relative to the working directory), `REVIEWS_DB=off` for none. Imported dynamically in a try: a Node without
  node:sqlite still starts, logs "reviews off", and `/reviews/*` answers like a Worker without D1
  (`enabled: false`). Passes `REVIEWS_ADMIN`, `REVIEWS_SALT`, `REVIEW_DAILY`, `REPORT_HIDE` from the environment
  (only when set, so reviews.js's defaults hold). Startup line names the database.
- `worker/Dockerfile`: `/data` owned by `node` (the image runs as `node` and can't write `/cydian`),
  `REVIEWS_DB=/data/reviews.db`, `VOLUME /data`.
- `worker/README.md`: Reviews paragraph under "On your own PC or in Docker"; docker run gains `-v cydian-data:/data`.

## Checked
- Node 26 locally: POST a review, restart, GET shows it (file persisted); DELETE with wrong bearer 403, with
  REVIEWS_ADMIN 200; `REVIEWS_DB=off` gives `enabled: false`.
- Docker (node:22-alpine): built, posted a rating, new container on the same volume reads it back. Node 22 prints
  an ExperimentalWarning for SQLite; harmless, left as is.

## Tried that failed
- First POST used a short X-Review-Token (needs 32+ chars): my test, not the code.

## Not verified
- No automated test for node.mjs's wiring: node.mjs starts a server at import, and worker/test.mjs already covers
  reviews.js over d1-sqlite.js. Checked by hand above.
- `reviews.db` is not in .gitignore (outside this task's files): running `node worker/node.mjs` from a checkout
  leaves an untracked `reviews.db` there. Harmless; add a line if it bothers anyone.
