// F93: Install on the website: the IPA through /api/fetch, signed in a Web Worker (a fake here: websign-job.test.js
// runs the real job), the signed IPA uploaded to the Worker's /sign/upload in parts, then iOS's install prompt; the
// HUD says Downloading, Signing, Uploading. Errors (zsign's own, the server's) end in an alert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInBrowser, downloadIpa, uploadSigned, runInWorker, getBring, setBring } from "./signing-client.js";

const ID = { p12: new Uint8Array([0x30, 1]), profile: new Uint8Array([2, 3]), password: "pw", passwordOk: true };
const IPA = new Uint8Array([0x50, 0x4b, 3, 4, 5, 6, 7, 8, 9, 10]);
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// The Worker's side: /api/fetch?kind=ipa answers the IPA; /sign/upload takes parts of 4 bytes.
function fakeServer({ ipa = IPA, fetchStatus = 200, uploadStatus = 200 } = {}) {
  const calls = [], parts = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://cydian.example");
    calls.push(`${init.method ?? "GET"} ${u.pathname}${u.pathname === "/api/fetch" ? "?" + u.searchParams : ""}`);
    if (u.pathname === "/api/fetch") return fetchStatus === 200 ? new Response(ipa, { headers: { "Content-Length": String(ipa.length) } }) : json({ code: "upstream", error: "upstream answered HTTP 404" }, fetchStatus);
    if (u.pathname === "/sign/upload") {
      if (uploadStatus !== 200) return json({ code: "too_large", error: "Apps up to 512 MB can be signed on the website." }, uploadStatus);
      const size = Number(u.searchParams.get("size"));
      calls.push(Object.fromEntries(u.searchParams));
      return json({ token: "t0k", partSize: 4, parts: Math.ceil(size / 4) });
    }
    if (u.pathname === "/sign/upload/t0k/done") return json({ itms: "itms-services://?action=download-manifest&url=x", expiresIn: 600 });
    const m = /^\/sign\/upload\/t0k\/(\d+)$/.exec(u.pathname);
    if (m) { parts[m[1]] = [...init.body]; return json({ ok: true }); }
    return json({ error: "no" }, 404);
  };
  return { fetcher, calls, parts };
}

function deps(over = {}) {
  const log = { hud: [], alerts: [], opened: [], banners: [], went: [], jobs: [] };
  const d = {
    hud: (t) => { log.hud.push(t); return { set: (x) => log.hud.push(x), hide: () => log.hud.push("hide"), done: (x) => log.hud.push("done " + x) }; },
    alert: async (a) => { log.alerts.push(a); return { index: 0 }; },
    banner: (b) => log.banners.push(b.message),
    open: (u) => log.opened.push(u),
    go: (p) => log.went.push(p.join("/")),
    identity: async () => ID,
    worker: async (job, { onProgress }) => {
      log.jobs.push(job);
      onProgress("Signing");
      return { ok: true, ipa: new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5]), bundleId: "com.you.delta", name: "Delta", version: "1.2" };
    },
    transfer: async () => "cydian://import?d=xyz",
    later: (f) => f(),
    ...over,
  };
  return { d, log };
}

test("Install on the website: download, sign in the worker, upload in parts, iOS's install prompt", async () => {
  const srv = fakeServer();
  const { d, log } = deps({ fetcher: srv.fetcher });
  let recorded = null;
  assert.equal(await signInBrowser({ url: "https://apps.example/Delta.ipa", name: "Delta", onInstalled: (r) => { recorded = r; } }, d), true);
  assert.deepEqual(log.hud, ["Downloading", "Downloading 99%", "Signing", "Signing", "Uploading", "Uploading 50%", "Uploading 100%", "Installing", "done Done"]);
  assert.equal(srv.calls[0], "GET /api/fetch?url=https%3A%2F%2Fapps.example%2FDelta.ipa&kind=ipa");
  assert.deepEqual(srv.calls[2], { bundleid: "com.you.delta", version: "1.2", title: "Delta", size: "7" });
  assert.deepEqual(srv.parts, [[0x50, 0x4b, 1, 2], [3, 4, 5]]);
  // the worker got the IPA and the certificate as transferable buffers; no bring for another app
  const job = log.jobs[0];
  assert.deepEqual([...new Uint8Array(job.ipa)], [...IPA]);
  assert.ok(job.p12 instanceof ArrayBuffer && job.profile instanceof ArrayBuffer);
  assert.equal(job.password, "pw");
  assert.equal(job.bring, null);
  assert.deepEqual(log.opened, ["itms-services://?action=download-manifest&url=x"]);
  assert.match(log.banners[0], /Press Install to put Delta/);
  assert.equal(recorded.bundleId, "com.you.delta");
  assert.deepEqual(log.alerts, []);
});

test("Install Cydian App: Cydian's IPA carries the certificate (bring) and the website's link", async () => {
  const srv = fakeServer();
  const { d, log } = deps({ fetcher: srv.fetcher });
  await signInBrowser({ url: "https://github.com/RyanAHayden/Cydian/releases/latest/download/Cydian.ipa", name: "Cydian", bring: true }, d);
  assert.deepEqual(log.jobs[0].bring, { identity: true, transfer: "cydian://import?d=xyz" });
  await signInBrowser({ url: "https://github.com/RyanAHayden/Cydian/releases/latest/download/Cydian.ipa", name: "Cydian", bring: false }, d);
  assert.deepEqual(log.jobs[1].bring, { identity: false, transfer: "cydian://import?d=xyz" }, "Bring My Certificate off: sources and settings only");
});

test("no certificate: an alert, then Settings > Signing; nothing downloads", async () => {
  const srv = fakeServer();
  const { d, log } = deps({ fetcher: srv.fetcher, identity: async () => ({ p12: ID.p12 }) });
  assert.equal(await signInBrowser({ url: "https://a.example/x.ipa" }, d), false);
  assert.equal(log.alerts[0].title, "No Certificate");
  assert.deepEqual(log.went, ["signing"]);
  assert.deepEqual(srv.calls, []);
});

test("errors show their reason: zsign's, the download's, the upload's", async () => {
  let { d, log } = deps({ fetcher: fakeServer().fetcher, worker: async () => { throw Object.assign(new Error("zsign: Invalid mach-o file."), { code: "sign_failed" }); } });
  assert.equal(await signInBrowser({ url: "https://a.example/x.ipa", name: "X" }, d), false);
  assert.deepEqual([log.alerts[0].title, log.alerts[0].message], ["Couldn't Install X", "zsign: Invalid mach-o file."]);
  assert.equal(log.hud.at(-1), "hide");
  ({ d, log } = deps({ fetcher: fakeServer({ fetchStatus: 404 }).fetcher }));
  await signInBrowser({ url: "https://a.example/x.ipa" }, d);
  assert.equal(log.alerts[0].message, "upstream answered HTTP 404");
  ({ d, log } = deps({ fetcher: fakeServer({ uploadStatus: 413 }).fetcher }));
  await signInBrowser({ url: "https://a.example/x.ipa" }, d);
  assert.match(log.alerts[0].message, /512 MB/);
  ({ d, log } = deps({ fetcher: async () => { throw new TypeError("offline"); } }));
  await signInBrowser({ url: "https://a.example/x.ipa" }, d);
  assert.match(log.alerts[0].message, /no connection/);
});

test("downloadIpa: a cap; uploadSigned: one part when it fits", async () => {
  const srv = fakeServer();
  await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher: srv.fetcher, max: 5 }), (e) => e.code === "too_large");
  const small = fakeServer();
  const r = await uploadSigned(new Uint8Array([0x50, 0x4b, 1]), { bundleId: "a.b", name: "", version: "" }, { fetcher: small.fetcher });
  assert.match(r.itms, /^itms-services:/);
  assert.deepEqual(small.parts, [[0x50, 0x4b, 1]]);
  assert.deepEqual(small.calls[1], { bundleid: "a.b", version: "1.0", title: "a.b", size: "3" });
});

test("runInWorker: progress, the answer, the worker's error, a browser without module workers", async () => {
  const fake = (reply) => () => {
    const w = { terminated: false, terminate() { this.terminated = true; },
      postMessage(job, transfer) { w.posted = { job, transfer }; queueMicrotask(() => { for (const m of reply) w.onmessage({ data: m }); }); } };
    return w;
  };
  const seen = [];
  const r = await runInWorker({ ipa: new ArrayBuffer(2), p12: new ArrayBuffer(1), profile: new ArrayBuffer(1) },
    { make: fake([{ progress: "Signing" }, { ok: true, bundleId: "a.b" }]), onProgress: (p) => seen.push(p) });
  assert.equal(r.bundleId, "a.b");
  assert.deepEqual(seen, ["Signing"]);
  await assert.rejects(runInWorker({}, { make: fake([{ ok: false, error: "zsign: nope.", code: "sign_failed" }]) }), /zsign: nope/);
  await assert.rejects(runInWorker({}, { make: () => { throw new TypeError("module workers"); } }), (e) => e.code === "unsupported");
});

test("Bring My Certificate: on unless turned off", () => {
  const store = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(getBring(), true);
    setBring(false);
    assert.equal(getBring(), false);
    setBring(true);
    assert.equal(getBring(), true);
  } finally { globalThis.localStorage = saved; }
});
