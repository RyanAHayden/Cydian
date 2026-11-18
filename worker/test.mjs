// node worker/test.mjs: the Worker's routes against an in-memory KV.
import assert from "node:assert/strict";
import w, { manifest, allowed, loopbackUrl, appOf } from "./src/index.js";
const store = new Map();
const env = { HOST_IDS: "*.cydian", TTL: "600", HOSTED: {
  put: async (k, v, o) => store.set(k, { v, m: o.metadata }),
  get: async (k) => store.get(k)?.v ?? null,
  getWithMetadata: async (k) => ({ value: null, metadata: store.get(k)?.m ?? null }) } };
const go = (path, init) => w.fetch(new Request("https://sign.example" + path, init), env);

assert.deepEqual(await (await go("/sign/status")).json(), { ok: true, ttl: 600, worker: true, zsign: false, upload: 512 * 1024 * 1024 });
let r = await go("/sign/manifest?bundleid=com.a.b&version=1.2&title=A%20%26%20B&port=8080&path=x/app.ipa");
let t = await r.text();
assert.match(t, /<string>http:\/\/127\.0\.0\.1:8080\/x\/app\.ipa<\/string>/);
assert.match(t, /<string>A &amp; B<\/string>/);
assert.equal((await go("/sign/manifest?bundleid=com.a&port=80&path=../../etc")).status, 200); // a path on the phone
assert.equal((await go("/sign/manifest?bundleid=com.a&port=x&path=a")).status, 400);
assert.equal(loopbackUrl(new URLSearchParams("port=1&path=a b")), null);
assert.ok(allowed("com.ryha.cydian") && allowed("com.team.cydian") && !allowed("com.evil.app"));
assert.equal(appOf(new URLSearchParams("bundleid=a/b")), null);

const ipa = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6]);
r = await go("/sign/host?bundleid=com.evil.app&version=1", { method: "POST", body: ipa, headers: { "Content-Length": "10" } });
assert.equal(r.status, 403);
r = await go("/sign/host?bundleid=com.ryha.cydian&version=0.3.2&title=Cydian", { method: "POST", body: ipa, headers: { "Content-Length": "10" } });
const j = await r.json();
assert.match(j.itms, /^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2Fsign\.example%2Fsign%2Fhost%2F[0-9a-f]{48}%2Fmanifest\.plist$/);
t = await (await go(new URL(j.manifest).pathname)).text();
assert.match(t, /\/app\.ipa<\/string>/);
assert.match(t, /<string>com\.ryha\.cydian<\/string>/);
const ipaPath = new URL(j.manifest).pathname.replace("manifest.plist", "app.ipa");
assert.deepEqual(new Uint8Array(await (await go(ipaPath)).arrayBuffer()), ipa);
r = await go(ipaPath, { headers: { Range: "bytes=2-4" } });
assert.equal(r.status, 206);
assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [3, 4, 1]);
assert.equal((await go("/sign/host/" + "0".repeat(48) + "/app.ipa")).status, 404);
r = await go("/sign/host?bundleid=com.ryha.cydian&version=1", { method: "POST", body: new Uint8Array([1, 2]), headers: { "Content-Length": "2" } });
assert.equal(r.status, 400); // not a zip
console.log("worker: ok");
import { httpUrl } from "./src/index.js";
assert.equal(httpUrl("ftp://x"), null);
assert.equal(httpUrl("https://u:p@x/"), null);
assert.ok(httpUrl("https://repo.example/"));
const bad = await go("/api/fetch?url=file:///etc/passwd");
assert.equal(bad.status, 400);
console.log("worker fetch: ok");

// F93: the website's signed IPA, uploaded in parts and served back whole (Range too).
import { PART, uploadCap } from "./src/index.js";
{
  assert.equal(uploadCap({}), 512 * 1024 * 1024);
  assert.equal(uploadCap({ MAX_UPLOAD_MB: "0" }), 0);
  assert.equal((await (await go("/sign/status")).json()).upload, 512 * 1024 * 1024);
  const size = PART + 5;
  const app = new Uint8Array(size);
  app[0] = 0x50; app[1] = 0x4b;
  for (let i = 2; i < size; i++) app[i] = i % 251;
  let r = await go(`/sign/upload?bundleid=com.any.app&version=2.0&title=Any&size=${size}`, { method: "POST" });
  const up = await r.json();
  assert.equal(r.status, 200);
  assert.equal(up.parts, 2);
  assert.equal(up.partSize, PART);
  const put = (i, body) => go(`/sign/upload/${up.token}/${i}`, { method: "PUT", body });
  // not finished: no link yet, and done refuses while a part is missing
  assert.equal((await go(`/sign/up/${up.token}/manifest.plist`)).status, 404);
  assert.equal((await put(0, app.slice(0, PART))).status, 200);
  assert.equal((await go(`/sign/upload/${up.token}/done`, { method: "POST" })).status, 409);
  assert.equal((await put(1, app.slice(PART, PART + 2))).status, 400); // wrong length
  assert.equal((await put(2, app.slice(PART))).status, 400);           // no such part
  assert.equal((await put(1, app.slice(PART))).status, 200);
  r = await go(`/sign/upload/${up.token}/done`, { method: "POST" });
  const done = await r.json();
  assert.equal(r.status, 200, JSON.stringify(done));
  assert.match(done.itms, /^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2Fsign\.example%2Fsign%2Fup%2F[0-9a-f]{48}%2Fmanifest\.plist$/);
  t = await (await go(new URL(done.manifest).pathname)).text();
  assert.match(t, /<string>com\.any\.app<\/string>/);
  assert.match(t, /\/sign\/up\/[0-9a-f]{48}\/app\.ipa<\/string>/);
  const appPath = `/sign/up/${up.token}/app.ipa`;
  r = await go(appPath);
  assert.equal(r.headers.get("content-length"), String(size));
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), app);
  r = await go(appPath, { headers: { Range: `bytes=${PART - 2}-${PART + 1}` } }); // across the parts
  assert.equal(r.status, 206);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...app.slice(PART - 2, PART + 2)]);
  assert.equal((await go(appPath, { method: "HEAD" })).headers.get("content-length"), String(size));
  // too big, not a zip, finished twice, uploads off
  assert.equal((await go(`/sign/upload?bundleid=com.a&size=${600 * 1024 * 1024}`, { method: "POST" })).status, 413);
  const z = await (await go(`/sign/upload?bundleid=com.a&size=4`, { method: "POST" })).json();
  assert.equal((await go(`/sign/upload/${z.token}/0`, { method: "PUT", body: new Uint8Array([1, 2, 3, 4]) })).status, 400);
  assert.equal((await go(`/sign/upload/${up.token}/done`, { method: "POST" })).status, 409);
  const off = await w.fetch(new Request("https://sign.example/sign/upload?bundleid=com.a&size=9", { method: "POST" }), { ...env, MAX_UPLOAD_MB: "0" });
  assert.equal(off.status, 403);
  // the website's own files that start with /sign go to the assets, the server's paths don't
  const assets = { fetch: async (q) => new Response("asset " + new URL(q.url).pathname) };
  const site = (path) => w.fetch(new Request("https://sign.example" + path), { ...env, ASSETS: assets });
  assert.equal(await (await site("/signing-worker.js")).text(), "asset /signing-worker.js");
  assert.equal((await site("/sign/nothing")).status, 404);
  console.log("worker upload: ok");
}
