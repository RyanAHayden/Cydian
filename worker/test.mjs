// node worker/test.mjs: the Worker's routes against an in-memory KV.
import assert from "node:assert/strict";
import w, { manifest, allowed, loopbackUrl, appOf } from "./src/index.js";
const store = new Map();
const env = { HOST_IDS: "*.cydian", TTL: "600", HOSTED: {
  put: async (k, v, o) => store.set(k, { v, m: o.metadata }),
  get: async (k) => store.get(k)?.v ?? null,
  getWithMetadata: async (k) => ({ value: null, metadata: store.get(k)?.m ?? null }) } };
const go = (path, init) => w.fetch(new Request("https://sign.example" + path, init), env);

assert.deepEqual(await (await go("/sign/status")).json(), { ok: true, ttl: 600, worker: true, zsign: false });
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
