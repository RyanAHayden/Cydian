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
{
  const { upstream, releaseFile } = await import("./src/index.js");
  assert.ok(releaseFile("https://github.com/RyanAHayden/Cydian/releases/download/v0.3.6/Cydian.ipa"));
  assert.equal(releaseFile("https://raw.githubusercontent.com/o/r/main/source.json"), false);
  const answers = [429, 503, 200];
  const seen = [];
  const r = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { wait: async () => {},
    fetcher: async (u, o) => { seen.push(o.cf.cacheTtl); return new Response("x", { status: answers.shift(), headers: {} }); } });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, [86400, 86400, 86400]); // retried twice, cached at the edge
  console.log("worker upstream: ok");
}
{
  const { upstream, githubRelease } = await import("./src/index.js");
  assert.deepEqual(githubRelease("https://github.com/FIZL0/opentennis/releases/download/v1.7.1/opentennis-ios.ipa"),
    { owner: "FIZL0", repo: "opentennis", tag: "v1.7.1", file: "opentennis-ios.ipa" });
  assert.equal(githubRelease("https://github.com/o/r/releases/latest/download/C.ipa").tag, null);
  assert.equal(githubRelease("https://example.com/a.ipa"), null);
  const calls = [];
  const fetcher = async (u, o = {}) => {
    calls.push([u, o.headers?.Authorization ? "auth" : "anon"]);
    if (u.startsWith("https://github.com/")) return new Response("slow down", { status: 429 });
    if (u.includes("/releases/tags/")) return Response.json({ assets: [{ name: "a.ipa", url: "https://api.github.com/repos/o/r/releases/assets/9" }] });
    if (u.endsWith("/assets/9")) return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/x" } });
    return new Response("IPA");
  };
  const r = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { fetcher, wait: async () => {}, token: "t" });
  assert.equal(await r.text(), "IPA");
  assert.deepEqual(calls.at(-1), ["https://release-assets.githubusercontent.com/x", "anon"]); // the blob store never sees the token
  const none = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { fetcher, wait: async () => {} });
  assert.equal(none.status, 429); // no token: as before
  console.log("worker github token: ok");
}

// F97: Cydian Account: the size cap, the version check (409), delete, and KV never keyed by the id itself.
import { account, MAX_ACCOUNT, rateLimiter, kvKey, bindingLimiter } from "./src/account.js";
{
  const kv = new Map();
  const aenv = { HOSTED: {
    put: async (k, v, o) => kv.set(k, { v, m: o?.metadata ?? null }),
    getWithMetadata: async (k) => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m ?? null }),
    delete: async (k) => { kv.delete(k); } } };
  const id = "ab".repeat(32);
  const send = (method, { body, headers = {}, limit = rateLimiter({ rate: 1000, writes: 1000 }), path = `/api/account/${id}` } = {}) =>
    account(new Request("https://cydian.example" + path, { method, body, headers }), aenv, { limit });
  const blob = (n, fill = 7) => new Uint8Array(n).fill(fill);

  assert.equal((await send("GET")).status, 404);
  assert.equal((await send("GET", { path: "/api/account/xyz" })).status, 404);
  assert.equal((await send("POST")).status, 405);
  // make it: If-None-Match: *
  let r = await send("PUT", { body: blob(100), headers: { "If-None-Match": "*" } });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("ETag"), '"1"');
  assert.deepEqual([...kv.keys()], [await kvKey(id)]);
  assert.ok(![...kv.keys()][0].includes(id), "KV's key isn't the id");
  r = await send("GET");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("ETag"), '"1"');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), blob(100));
  // a second device that made it too, or wrote without the version: 409 with the current ETag
  r = await send("PUT", { body: blob(100, 1), headers: { "If-None-Match": "*" } });
  assert.equal(r.status, 409);
  assert.equal(r.headers.get("ETag"), '"1"');
  assert.equal((await send("PUT", { body: blob(100, 1) })).status, 409);
  // the right version replaces it; the old one then conflicts
  r = await send("PUT", { body: blob(120, 2), headers: { "If-Match": '"1"' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { version: 2 });
  r = await send("PUT", { body: blob(120, 3), headers: { "If-Match": '"1"' } });
  assert.equal(r.status, 409);
  assert.equal(r.headers.get("ETag"), '"2"');
  assert.deepEqual(new Uint8Array(await (await send("GET")).arrayBuffer()), blob(120, 2));
  // the size cap: by the header, and by what really came
  assert.equal((await send("PUT", { body: blob(MAX_ACCOUNT + 1), headers: { "If-Match": '"2"' } })).status, 413);
  const big = new ReadableStream({ start(c) { c.enqueue(blob(MAX_ACCOUNT)); c.enqueue(blob(10)); c.close(); } });
  r = await account(new Request(`https://cydian.example/api/account/${id}`, { method: "PUT", body: big, duplex: "half",
    headers: { "If-Match": '"2"' } }), aenv, { limit: rateLimiter({ rate: 9, writes: 9 }) });
  assert.equal(r.status, 413);
  assert.equal((await send("PUT", { body: blob(MAX_ACCOUNT), headers: { "If-Match": '"2"' } })).status, 200);
  assert.equal((await send("PUT", { body: blob(5), headers: { "If-Match": '"3"' } })).status, 400); // too short to be ciphertext
  // delete, then it's gone
  assert.equal((await send("DELETE")).status, 200);
  assert.equal((await send("GET")).status, 404);
  assert.equal(kv.size, 0);
  // per address: writes run out before reads
  const lim = rateLimiter({ rate: 2, writes: 1 });
  assert.equal((await send("PUT", { body: blob(40), headers: { "If-None-Match": "*" }, limit: lim })).status, 201);
  assert.equal((await send("PUT", { body: blob(40), headers: { "If-Match": '"1"' }, limit: lim })).status, 429);
  assert.equal((await send("GET", { limit: lim })).status, 200);
  assert.equal((await send("GET", { limit: lim })).status, 429);
  assert.ok(lim.allow("?", true, Date.now() + 61000), "a new minute");
  // F98: Cloudflare's Rate Limiting bindings, when bound, count instead of memory (shared across isolates)
  const fakeRL = (n) => { const used = new Map(); return { keys: used, async limit({ key }) {
    const k = used.get(key) ?? 0; used.set(key, k + 1); return { success: k < n }; } }; };
  const all = fakeRL(3), wr = fakeRL(1); // the refused write still took one from all
  const benv = { ...aenv, ACCOUNT_RATE_LIMIT: all, ACCOUNT_WRITE_LIMIT: wr };
  const bsend = (method, opts = {}) => account(new Request(`https://cydian.example/api/account/${id}`, { method, ...opts }), benv);
  assert.equal((await bsend("DELETE")).status, 200);
  assert.equal((await bsend("DELETE")).status, 429, "writes run out first");
  assert.equal((await bsend("GET")).status, 404);
  assert.equal((await bsend("GET")).status, 429);
  assert.deepEqual([...all.keys.keys()], ["?"]);
  // one binding only: writes count under "w:<ip>" in it
  const one = fakeRL(1), solo = bindingLimiter(one, null, rateLimiter({ rate: 0, writes: 0 }));
  assert.equal(await solo.allow("1.2.3.4", true), true);
  assert.deepEqual([...one.keys.keys()], ["1.2.3.4", "w:1.2.3.4"]);
  // a binding that throws falls back to the memory limiter
  const broken = { async limit() { throw new Error("down"); } };
  const fb = rateLimiter({ rate: 1, writes: 1 });
  assert.equal(await bindingLimiter(broken, null, fb).allow("x", false), true);
  assert.equal(await bindingLimiter(broken, null, fb).allow("x", false), false);
  assert.equal((await account(new Request(`https://cydian.example/api/account/${id}`), { ...aenv, ACCOUNT_RATE_LIMIT: broken })).status, 404);
  // through the Worker: the route, and CORS for the app's cydian://app page
  const pre = await w.fetch(new Request(`https://cydian.example/api/account/${id}`, { method: "OPTIONS" }), aenv);
  assert.match(pre.headers.get("Access-Control-Allow-Methods"), /PUT/);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /If-Match/);
  assert.equal((await w.fetch(new Request(`https://cydian.example/api/account/${id}`), aenv)).headers.get("Access-Control-Expose-Headers"), "ETag");
  console.log("worker account: ok");
}

// F121: the website's own token, opened as an install link inside the Install tap before it signs: the manifest waits
// for the reservation, app.ipa until the upload's done (waits scaled down: WAIT_SCALE).
import { waitFor, MANIFEST_WAIT, IPA_WAIT } from "./src/index.js";
{
  assert.ok(MANIFEST_WAIT <= 20000 && IPA_WAIT >= 60000);
  // held requests get room (POLL 75 ms, manifest 0.75 s, app.ipa 6 s) so a loaded machine can't time them out;
  // the give-up cases are fast (POLL 3 ms, manifest 30 ms, app.ipa 240 ms)
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), { ...env, WAIT_SCALE: "0.05" });
  const quick = (path, init) => w.fetch(new Request("https://sign.example" + path, init), { ...env, WAIT_SCALE: "0.002" });
  const tok = "ab".repeat(24), app = new Uint8Array([0x50, 0x4b, 9, 8, 7, 6]);
  assert.equal((await at(`/sign/upload?bundleid=com.a&token=xyz`, { method: "POST" })).status, 400);
  // iOS asks for the manifest before the reservation lands: it waits, then answers with the reserved app
  const early = at(`/sign/up/${tok}/manifest.plist`);
  await new Promise((r) => setTimeout(r, 5));
  let r = await at(`/sign/upload?bundleid=com.ryha.cydian&version=0.4&title=Cydian&token=${tok}`, { method: "POST" });
  assert.deepEqual(await r.json(), { token: tok, reserved: true, expiresIn: 600 });
  r = await early;
  assert.equal(r.status, 200);
  assert.match(await r.text(), new RegExp(`<string>com\\.ryha\\.cydian</string>[\\s\\S]*/sign/up/${tok}/app\\.ipa|/sign/up/${tok}/app\\.ipa[\\s\\S]*<string>com\\.ryha\\.cydian</string>`));
  // a reserved token can't be taken for another app, nor its parts sent before its size
  assert.equal((await at(`/sign/upload?bundleid=com.other&size=6&token=${tok}`, { method: "POST" })).status, 409);
  assert.equal((await at(`/sign/upload/${tok}/0`, { method: "PUT", body: app })).status, 409);
  // app.ipa holds while the website signs; its headers come once the upload starts, its body once it's done
  const held = at(`/sign/up/${tok}/app.ipa`);
  r = await at(`/sign/upload?bundleid=com.ryha.cydian&version=0.4&title=Cydian&token=${tok}&size=${app.length}`, { method: "POST" });
  assert.equal((await r.json()).parts, 1);
  r = await held;
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-length"), String(app.length));
  const ranged = at(`/sign/up/${tok}/app.ipa`, { headers: { Range: "bytes=2-3" } }); // a Range waits for done
  let answered = false;
  const whole = r.arrayBuffer().then((b) => { answered = true; return b; });
  assert.equal((await at(`/sign/upload/${tok}/0`, { method: "PUT", body: app })).status, 200);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(answered, false);
  const done = await (await at(`/sign/upload/${tok}/done`, { method: "POST" })).json();
  assert.equal(new URL(done.manifest).pathname, `/sign/up/${tok}/manifest.plist`);
  assert.deepEqual(new Uint8Array(await whole), app);
  r = await ranged;
  assert.equal(r.status, 206);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [9, 8]);
  // started once: the token is taken now
  assert.equal((await at(`/sign/upload?bundleid=com.ryha.cydian&size=6&token=${tok}`, { method: "POST" })).status, 409);
  // the link's own query: the manifest answers at once, before any reservation
  const t3 = "ef".repeat(24), t3s = Date.now();
  r = await go(`/sign/up/${t3}/manifest.plist?bundleid=com.you.delta&version=1.2&title=Delta`);
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t3s < 1000);
  assert.match(await r.text(), /<string>com\.you\.delta<\/string>/);
  // nothing reserved: the manifest gives up after its wait; a reservation never uploaded: app.ipa gives up after its
  const t2 = "cd".repeat(24);
  assert.equal((await quick(`/sign/up/${t2}/manifest.plist`)).status, 404);
  await quick(`/sign/upload?bundleid=com.a&token=${t2}`, { method: "POST" });
  r = await quick(`/sign/up/${t2}/app.ipa`);
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /in time/);
  // a plain upload's link still doesn't wait: 404 at once while it isn't done
  const plainUp = await (await go(`/sign/upload?bundleid=com.a&size=4`, { method: "POST" })).json();
  const t0 = Date.now();
  assert.equal((await go(`/sign/up/${plainUp.token}/app.ipa`)).status, 404);
  assert.ok(Date.now() - t0 < 1000);
  // waitFor: looks until ok or out of time
  let n = 0;
  assert.equal(await waitFor(async () => ++n, (v) => v === 3, 60000, {}, async () => {}), 3);
  console.log("worker reserved link: ok");
}
