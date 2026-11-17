# F47: asynchronous signing jobs

Big IPAs took longer than a proxy's timeout (Cloudflare 100 s, Nginx 60 s) because POST /sign answered only after
the download and zsign. Now the page asks for a job and polls it.

## What I did

- `web/signer/__init__.py`: `Jobs` (job id -> status/answer, in memory, ids `token_urlsafe(32)` because a done job
  holds the install link; finished jobs kept for TTL, running ones until they end). POST /sign with `"async": true`
  runs the checks that need no IPA (rate limit, p12/password/profile/cert, zsign present, store room, job slot) in
  the request, then answers 202 `{job, status: "downloading", poll: 1}` + `Location`, and a daemon thread runs
  `_run` (which now reports `downloading` / `signing` through `on_phase`). GET /sign/job/<id> answers
  `{job, status}` plus the synchronous answer's fields when done, or `{error, code, httpStatus}` on error; 404
  `gone` for unknown/expired. CORS preflight for it too. `/sign/status` adds `jobs: true`.
- `web/app/signing-client.js`: sends `async: true`; on 202 `pollJob` polls every `poll` s (clamped 0.5-5 s) under
  the same "Signing" HUD; rides out up to 5 failed polls in a row (network errors, 5xx without a job body); gives
  up after 15 min. A 200 with the link (an old server) still works.
- Tests: `AsyncJobTest` in `web/test_signer.py` (zsign mocked with a gated copy so the phases are observable and it
  runs without zsign), one real-zsign async test in `SignTest`, `web/app/signing-client.test.js` for the poll.
- `docs/signing.md`: the protocol, storage table row, Limits (proxy timeouts, one worker), Tests.

## Decisions

- **Async is opt-in (`"async": true`), not the default.** The brief says POST answers 202; I kept the synchronous
  answer for requests without the flag so a page cached from before F47, curl and scripts keep working, and every
  existing guard test stays meaningful. The page always sends the flag, so for the site the POST does answer 202.
- **The certificate checks stay in the POST.** A wrong password or expired profile still fails at once; only the
  download, inspection and zsign go to the thread.
- The job frees its slot *before* it reports done/error, so a poll that sees "done" can sign again at once
  (found as a race in my own slot test).
- The HUD stays "Signing" through downloading and signing, as the brief says (no new "Downloading" label).

## Not verified

- **Real zsign with async jobs** (`SignTest.test_async_job_signs` and the rest of `SignTest`): zsign isn't
  installed on this machine, so those skip. The async path around zsign is covered with zsign mocked.
- **The page in a browser / on a phone behind Cloudflare or Nginx**: no signing server with a real certificate
  and HTTPS here; the poll logic is tested in node with a mocked `fetch`, and the server with Flask's test client.
