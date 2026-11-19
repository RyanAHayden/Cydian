# B114: node.mjs's KV hands back KV's types

## What was wrong
`worker/node.mjs`'s in-memory KV ignored `get(k, { type })`: it returned whatever was stored (the part's raw
ArrayBuffer). `upPump` in `src/index.js` calls `data.pipeTo(...)` on a `type: "stream"` get, which threw after the
headers were sent, so `/sign/up/<token>/app.ipa` ended with no reply (curl: 52, Python: RemoteDisconnected).

## What I did
- `node.mjs`: an `as(value, type)` helper turns a stored value (string, ArrayBuffer or typed array) into what
  Cloudflare KV returns for `text` (default), `json`, `arrayBuffer` and `stream` (a fresh `Blob(...).stream()` per
  read). Both `get` and `getWithMetadata` use it; a string type (`get(k, "stream")`) is accepted as KV does.
  `getWithMetadata(k, { type: "stream" })` used to give `value: null`; the callers only read metadata and
  `cancel?.()` the value, so a real stream there is fine.
- `worker/test_entry.py`: `NodeServerTest` starts `node worker/node.mjs` on a free port (REVIEWS_DB=off), uploads a
  two-part IPA (20 MB + 1200 bytes), posts done, and checks app.ipa's Content-Length and SHA-256, plus a Range cut
  across the part boundary. Skipped where `node` isn't on PATH.
- Checked the test against the old node.mjs (temporary copy, removed): it fails with RemoteDisconnected, the bug.

## Tried that failed
- First test run compared `dict(r.headers).get("Content-Length")`: node writes lowercase names, and the dict loses
  the case-insensitive lookup. Used the HTTPMessage itself.

## Not verified
- A real iPhone install from a self-hosted node.mjs (behind HTTPS) and the setup command's download: no task scope
  for a phone or a tunnel; the round-trip test covers the same endpoint over HTTP.
- Docker image (`worker/Dockerfile`): not built; it runs the same node.mjs.
