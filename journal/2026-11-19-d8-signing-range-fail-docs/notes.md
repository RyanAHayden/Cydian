# D8: docs/signing.md, the website download's Range resume and the early link's /fail

## What I did

- "The website signs in the browser", Install step 1 (Downloading): the Worker passes the IPA's body through
  untouched (why: exceededCpu on a 104 MB IPA), sends `X-IPA-Length`, and the browser checks the cap and the length
  itself. `downloadIpa` resumes a broken or short body with `Range: bytes=n-`, which `/api/fetch?kind=ipa` passes
  upstream (only that form), up to `CUT_TRIES` (5) tries that each bring more. A non-matching answer restarts from
  byte 0, and the final failure text is `CUT_TEXT`.
- After the early-link paragraph: `dropEarly` → `POST /sign/upload/<token>/fail`. The Worker marks the token failed,
  its manifest and `app.ipa` (also a held request) answer 404 "That install was stopped…", and once parts have started
  arriving the call is refused with 409. A failed token can't be reserved or uploaded into again. When iOS was sent
  to the link, the failure alert adds `iconLeftText` (delete a blank icon).
- I took every fact from the code: `web/app/signing-client.js` (downloadIpa, downloadIpaOnce, dropEarly,
  iconLeftText, signAndInstall's `drop`) and `worker/src/index.js` (ipaFetch, the `/fail` route, `stopped()`, the
  reservation's 409 on `before.failed`).

## Not verified

- I didn't test anything against the live Worker or on a phone. This task changes only docs, and the behaviour is
  B95's, which its own tests cover (`web/app/download-cut.test.js`, `web/app/early-drop.test.js`).
