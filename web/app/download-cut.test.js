// B87: Install on the Website failed the first time with Safari's bare "Load failed", then worked: the IPA's body
// broke off after /api/fetch had answered (a cold download from GitHub through the Worker), which `retrying` doesn't
// cover. downloadIpa fetches a body that breaks off, or ends short of X-IPA-Length, once more; a second break is
// said in words, never as "Load failed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadIpa, signInBrowser, CUT_TEXT } from "./signing-client.js";

const IPA = new Uint8Array([0x50, 0x4b, 3, 4, 5, 6, 7, 8, 9, 10]);

// One /api/fetch answer per call: "ok" (the whole IPA), "drop" (half, then Safari's TypeError), "short" (half, then
// a clean end), each with the length only in X-IPA-Length, as Cloudflare sends it.
function server(plan) {
  const calls = [];
  const fetcher = async (url) => {
    const kind = plan[Math.min(calls.length, plan.length - 1)];
    calls.push(String(url));
    const body = new ReadableStream({
      start(c) {
        c.enqueue(IPA.slice(0, kind === "ok" ? IPA.length : 5));
        if (kind === "drop") c.error(new TypeError("Load failed")); else c.close();
      },
    });
    return new Response(body, { headers: { "X-IPA-Length": String(IPA.length) } });
  };
  return { fetcher, calls };
}

test("downloadIpa: a body that breaks off (Load failed) is fetched once more", async () => {
  const s = server(["drop", "ok"]);
  assert.deepEqual(await downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher }), IPA);
  assert.equal(s.calls.length, 2);
});

test("downloadIpa: a body that ends short of X-IPA-Length is fetched once more", async () => {
  const s = server(["short", "ok"]);
  assert.deepEqual(await downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher }), IPA);
  assert.equal(s.calls.length, 2);
});

test("downloadIpa: X-IPA-Length gives the progress its total", async () => {
  const s = server(["ok"]), seen = [];
  await downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher, onProgress: (p) => seen.push(p) });
  assert.deepEqual(seen, [99]);
  assert.equal(s.calls.length, 1);
});

test("downloadIpa: only one more try; the second break is said in words", async () => {
  for (const kind of ["drop", "short"]) {
    const s = server([kind]);
    await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher }),
      (e) => e.code === "network" && e.message === CUT_TEXT && !/Load failed/.test(e.message));
    assert.equal(s.calls.length, 2);
  }
});

test("downloadIpa: Cancel during a broken body isn't tried again", async () => {
  const ctl = new AbortController(), calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return new Response(new ReadableStream({ pull(c) { ctl.abort(); c.error(new TypeError("Load failed")); } }),
      { headers: { "X-IPA-Length": "10" } });
  };
  await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher, signal: ctl.signal }), (e) => e.code === "cancelled");
  assert.equal(calls.length, 1);
});

test("signInBrowser: the first Install's cut download goes on to sign and upload", async () => {
  const s = server(["drop", "ok"]), alerts = [];
  let signedBytes = null;
  const base = s.fetcher;
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    if (u.pathname === "/api/fetch") return base(url, init);
    if (u.pathname === "/sign/upload") return Response.json({ token: "t0k", partSize: 64, parts: 1 });
    if (u.pathname === "/sign/upload/t0k/0") return Response.json({ ok: true });
    if (u.pathname === "/sign/upload/t0k/done") return Response.json({ itms: "itms-services://?action=download-manifest&url=x" });
    return Response.json({ error: "no" }, { status: 404 });
  };
  const ok = await signInBrowser({ url: "https://a.example/x.ipa", name: "X" }, {
    hud: () => ({ set() {}, hide() {} }),
    alert: async (a) => { alerts.push(a); return { index: 1 }; },
    open: () => {}, identity: async () => ({ p12: new Uint8Array([1]), profile: new Uint8Array([2]), password: "" }),
    now: () => null, fetcher, transfer: async () => null,
    worker: async (job) => { signedBytes = new Uint8Array(job.ipa); return { ipa: new Uint8Array([0x50, 0x4b]), bundleId: "a.b", name: "X", version: "1" }; },
  });
  assert.equal(ok, true);
  assert.deepEqual(signedBytes, IPA);
  assert.deepEqual(alerts.map((a) => a.title), ["Ready to Install"]);
});

// B95: the Worker hands the body on untouched, so a body that breaks off is resumed from the bytes already here, with
// Range: bytes=n- (passed on by the Worker), as long as each try brings more.
function ranged(cuts) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const range = init.headers?.Range ?? null;
    calls.push(range);
    const from = range ? Number(/^bytes=(\d+)-$/.exec(range)[1]) : 0;
    const stop = cuts[calls.length - 1] ?? IPA.length; // where this answer's body breaks off
    let sent = false; // the bytes first, then the break (an error in start would drop the queued bytes)
    const body = new ReadableStream({
      pull(c) {
        if (!sent) { sent = true; c.enqueue(IPA.slice(from, Math.max(from, stop))); return; }
        if (stop < IPA.length) c.error(new TypeError("Load failed")); else c.close();
      },
    }, { highWaterMark: 0 });
    return new Response(body, range
      ? { status: 206, headers: { "X-IPA-Length": String(IPA.length), "Content-Range": `bytes ${from}-${IPA.length - 1}/${IPA.length}` } }
      : { headers: { "X-IPA-Length": String(IPA.length), "Content-Length": String(IPA.length) } });
  };
  return { fetcher, calls };
}

test("downloadIpa: a broken body is resumed from where it broke off (Range)", async () => {
  const s = ranged([3, 6, 8]);
  assert.deepEqual(await downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher }), IPA);
  assert.deepEqual(s.calls, [null, "bytes=3-", "bytes=6-", "bytes=8-"]);
});

test("downloadIpa: a resume that brings nothing new ends in words", async () => {
  const s = ranged([4, 4]);
  await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher }), (e) => e.code === "network" && e.message === CUT_TEXT);
  assert.deepEqual(s.calls, [null, "bytes=4-"]);
});

test("downloadIpa: an answer to a resume that isn't the asked-for part starts again from byte 0", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push(init.headers?.Range ?? null);
    const first = calls.length === 1;
    let sent = false;
    const body = new ReadableStream({ pull(c) {
      if (!sent) { sent = true; c.enqueue(IPA.slice(0, first ? 4 : IPA.length)); return; }
      if (first) c.error(new TypeError("Load failed")); else c.close();
    } }, { highWaterMark: 0 });
    return new Response(body, { headers: { "X-IPA-Length": String(IPA.length) } }); // a 200: the Range was ignored
  };
  assert.deepEqual(await downloadIpa("https://a.example/x.ipa", { fetcher }), IPA);
  assert.deepEqual(calls, [null, "bytes=4-"]);
});

test("downloadIpa: a body over the cap is stopped here, without a length too", async () => {
  const fetcher = async () => new Response(new ReadableStream({ start(c) { c.enqueue(IPA); c.close(); } }));
  await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher, max: 5 }), (e) => e.code === "too_large");
});
