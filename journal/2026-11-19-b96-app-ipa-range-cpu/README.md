# B96: Range reads of /sign/up/<token>/app.ipa without whole-part reads

wrangler tail showed ~37 ms Worker CPU on iOS's Range requests for a website-signed app.ipa. `upPump` read a
Range's cut first/last part with `HOSTED.get(..., { type: "arrayBuffer" })`: a 20 MB allocation and copy each,
even when the Range wanted a few bytes.

## What changed

- `worker/src/index.js`: every part is now read as KV's stream. Whole parts are piped natively as before; cut
  parts go through a new `pipeCut(data, a, b, size, out)`:
  - chunks before `a` are dropped as they arrive (nothing is copied, nothing written);
  - the chunk holding `a` (and any after it, up to `b`) is written as a `subarray` view;
  - a cut that runs to the part's end (`bytes=n-`, the common resume case) releases the reader after the chunk
    holding `a` and pipes the rest natively;
  - a cut that stops short cancels KV's stream as soon as it has `b`, so the rest of the part is never read.
- `worker/test.mjs`: the in-memory KV's stream is now pull-based (a chunk per pull, `highWaterMark: 0`) and records
  every get's type (`kvReads`) and every cancel (`kvCancels`). New Range cases: inside the first half of a part
  (asserts the stream was cancelled with the second chunk unread), mid-part to the end, a suffix range, a range
  across KV's chunk boundary, and a whole part as a range. Each asserts the bytes and that no part was read as
  anything but a stream (the old code fails that check).

## Tried / considered

- KV has no ranged get, and Workers have no native "skip n bytes" stream, so the prefix of a cut part still flows
  through a JS reader loop: one `read()` per KV chunk, no copy. The suffix is native where the cut reaches the end.

## Not verified

- The actual Worker CPU time after the change: needs a deploy and `wrangler tail` while iOS installs a big app.
  Unattended runs don't deploy (publishing is the runner's job), so the ~37 ms figure is not re-measured. Expected:
  the prefix skip costs one JS iteration per KV chunk instead of a 20 MB copy; a short Range stops reading early.
- Behaviour of `rd.cancel()` / `releaseLock()` then `pipeTo` on Cloudflare's real KV stream (only Node's streams
  were tested). Both are standard Streams API calls the runtime supports.
