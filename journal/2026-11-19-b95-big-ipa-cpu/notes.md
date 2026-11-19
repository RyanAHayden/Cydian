# B95: Website Install of big IPAs broke off (Worker out of CPU)

## What was wrong

`/api/fetch?kind=ipa` (worker/src/index.js `ipaFetch`) piped the IPA through a JS `TransformStream` (byte cap,
B87's short-end check). Every chunk cost Worker CPU, and a 104 MB IPA (Unbound) went over the limit: the user saw
"The app's download broke off before the end", and wrangler tail showed `exceededCpu`.

## What changed

- `ipaFetch` returns `new Response(r.body, …)`, with no JS per chunk. It still refuses an upstream Content-Length
  over the cap up front (and a resumed answer's total from Content-Range), and still sends `X-IPA-Length`.
  `Content-Length` now comes through too. A request's `Range: bytes=n-` (only that shape) goes on to upstream
  (`upstream(…, { range })`), and a 206 is passed on with its Content-Range.
- `downloadIpa` (web/app/signing-client.js) now checks the cap and the length itself (it already did). A body that
  breaks off is **resumed** with `Range: bytes=n-` from the bytes already here, up to `CUT_TRIES` (5) times while each
  try brings more. An answer that isn't the asked-for part (a 200) starts again from 0. A try that brings nothing
  new ends with CUT_TEXT. This replaces B87's single restart from 0.
- `/sign/up/<token>/app.ipa` (the leg My IPAs uses too): the JS `ReadableStream` pull loop that copied each 20 MB KV
  part with `data.slice` is gone. `upPump` pipes each whole part as KV's own stream (`type: "stream"`, `pipeTo` with
  `preventClose`, native, no copy) into the FixedLengthStream. Only a Range's cut first and last parts go through
  JS, as views. It runs under `ctx.waitUntil`: without that, the client hung up once it had Content-Length bytes,
  before the pump wrote the `finished` mark (seen live: status stayed `finished: false`).
- Leftover home-screen icon (F121's early link): new `POST /sign/upload/<token>/fail`. The website calls it
  (`dropEarly`) when the sign fails, is cancelled, comes out under another bundle ID, or there is no certificate,
  after iOS was sent to the early link. The Worker marks the reservation `failed`. iOS's held `app.ipa` (and later
  `app.ipa`/manifest requests) then answer 404 at once instead of holding up to 2 minutes, and the token can't be
  started again. The route is refused (409) once parts have come. The failure alert also says
  "If a blank <app> icon stays on the Home Screen, press and hold it and delete it." (`iconLeftText`), whenever iOS
  was sent to the link.
- Tests: worker/test.mjs (the pass-through body is upstream's own stream object, the 413 up front, the Range pass-on,
  the fail route; the KV mock answers `type: "stream"`). download-cut.test.js (resume tests). New
  early-drop.test.js (drop on failure, mismatch, Cancel; not dropped when used).

## Checked live (temporary Worker `ifizbox-b95-test` on workers.dev, same KV, deleted afterwards)

Production deploys from main (Workers Builds), so this branch went to a throwaway Worker instead.
- `/api/fetch?kind=ipa` for the Unbound URL: **19 of 19 runs got 104175897 bytes** (two sets of curl x10; the
  very first request of the first set was a 17-byte 404 from workers.dev, made seconds after the deploy, before
  the new route was live). Each took 1.4–5.9 s. Headers: `content-length: 104175897`, `x-ipa-length: 104175897`.
  `Range: bytes=100000000-` → 206, `content-range: bytes 100000000-104175896/104175897`, 4175897 bytes.
- wrangler tail: 20 `ok` outcomes, **0 exceededCpu**, cpuTime 1–5 ms each.
- KV leg: uploaded Unbound (5 parts) through `/sign/upload`, then curl `app.ipa` x5: 104175897 bytes every time, cpuTime
  3–9 ms, no exceededCpu. After the waitUntil fix, status = `{started: true, finished: true}`. Tail labels these
  requests `canceled` (the client hangs up when it has all bytes); the bytes are complete.
- A Range across two parts costs **36–37 ms** CPU (two 20 MB parts read as arrayBuffer). It went through (`ok`), but
  it is over the 10 ms free-plan figure. Only iOS's Range requests take this path: filed as a follow-up.
- PUT of a 20 MB part: 16–27 ms CPU, `ok` (that code was already there and B95 didn't change it).
- Fail route: reserved token, held `app.ipa` with curl, POST fail after 4 s. The held request answered 404 at 4.58 s
  ("That install was stopped"), and the manifest answered 404 after it.

No hard size limit needs stating on the website: plain pass-through is enough. The limits that are left are the ones already
shown: signing is capped at 512 MB (MAX_UPLOAD_MB), and My IPAs keeps up to 400 MB.

## Tried and dropped

- Renaming `CYDIA` to add the Range header: reverted (other code uses it). A local `asked` header object instead.
- Test fixture: a `ReadableStream` that enqueues then errors in `start` drops the queued bytes, so the resume
  tests break off in `pull` instead.

## Not verified

- **Whether iOS removes the blank icon** once the Worker answers its held `app.ipa` with 404 after `/fail`. That needs
  an iPhone driven through a failing early-link install, and the task didn't call for the iPhone 7. The failure text
  tells the user to delete the icon either way.
- **The production deploy** (ifizbox.com): it happens when this branch merges to main (Workers Builds). Only the
  throwaway Worker was tested, with the same code, KV and vars, but on workers.dev and without D1/assets/rate limits,
  which these routes don't use.
- **Safari's resume in a real browser**: `downloadIpa`'s Range resume is unit-tested and the Worker's 206 was
  checked with curl, but a real Safari download that breaks off and resumes wasn't run (no failure to reproduce
  now that the cut is gone).
