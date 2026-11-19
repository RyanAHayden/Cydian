// B87: Install on the Website failed the first time with Safari's bare "Load failed", then worked: the IPA's body
// broke off after /api/fetch had answered (a cold download from GitHub through the Worker), which `retrying` doesn't
// cover. downloadIpa fetches a body that breaks off, or ends short of X-IPA-Length, once more; a second break is
// said in words, never as "Load failed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadIpa, signInBrowser, CUT_TEXT, CUT_TRIES, reconnectText, droppedText, grayIconText } from "./signing-client.js";

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

test("downloadIpa: F257: three more tries; the last break is said in words", async () => {
  for (const kind of ["drop", "short"]) {
    const s = server([kind]);
    await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher }),
      (e) => e.code === "network" && e.message === CUT_TEXT && !/Load failed/.test(e.message));
    assert.equal(s.calls.length, 1 + CUT_TRIES);
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

test("downloadIpa: F257: breaks that bring nothing new end in words after the third try", async () => {
  const s = ranged([4, 4, 4, 4]), seen = [];
  await assert.rejects(downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher, onCut: (c) => seen.push(c) }),
    (e) => e.code === "network" && e.message === CUT_TEXT);
  assert.deepEqual(s.calls, [null, "bytes=4-", "bytes=4-", "bytes=4-"]);
  assert.deepEqual(seen, [1, 2, 3].map((attempt) => ({ attempt, of: 3, at: 4 })));
});

test("downloadIpa: F257: a body cut once, then answered 206 from that byte, comes out whole", async () => {
  const s = ranged([6]), seen = [];
  assert.deepEqual(await downloadIpa("https://a.example/x.ipa", { fetcher: s.fetcher, onCut: (c) => seen.push(c) }), IPA);
  assert.deepEqual(s.calls, [null, "bytes=6-"]);
  assert.deepEqual(seen, [{ attempt: 1, of: 3, at: 6 }]);
});

test("F257: the log's lines for a resume", () => {
  assert.equal(reconnectText(2), "Reconnecting (try 2 of 3)");
  assert.equal(droppedText(41 * 1048576 + 300000), "The connection dropped at 41 MB.");
  assert.equal(droppedText(3.25 * 1048576), "The connection dropped at 3.3 MB.");
  assert.equal(grayIconText("Unbound"), "If a gray Unbound icon was left on your Home Screen, delete it.");
});

// A progress page that keeps its lines: [kind, text] in order (set() as step lines, as progressHUD draws them).
function logHud() {
  const lines = [];
  let last = null;
  const page = { raw: (t) => lines.push(["raw", t]), warning: (t) => lines.push(["warning", t]), error: (t) => lines.push(["error", t]) };
  return { lines, hud: () => ({ page, set(t) { const w = String(t).replace(/\s*\d+%$/, ""); if (w !== last) lines.push(["step", w]); last = w; },
    hide() {}, fail(m) { lines.push(["error", m]); } }) };
}
const signDeps = (fetcher, extra = {}) => ({
  alert: async () => ({ index: 0 }), open: () => {}, identity: async () => ({ p12: new Uint8Array([1]), profile: new Uint8Array([2]), password: "" }),
  now: () => null, fetcher, transfer: async () => null, phone: async () => null,
  worker: async () => ({ ipa: new Uint8Array([0x50, 0x4b]), bundleId: "a.b", name: "X", version: "1" }), ...extra });

test("signInBrowser: F257: a resumed download says so on the log (grey drop line, then the step)", async () => {
  const s = ranged([4]);
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    if (u.pathname === "/api/fetch") return s.fetcher(url, init);
    if (u.pathname === "/sign/upload") return Response.json({ token: "t0k", partSize: 64, parts: 1 });
    if (u.pathname.startsWith("/sign/upload/t0k/")) return Response.json({ ok: true, itms: "itms-services://x" });
    return Response.json({ error: "no" }, { status: 404 });
  };
  const { lines, hud } = logHud();
  await signInBrowser({ url: "https://a.example/x.ipa", name: "X" }, signDeps(fetcher, { hud }));
  const i = lines.findIndex(([, t]) => /dropped/.test(t));
  assert.deepEqual(lines.slice(i, i + 2), [["raw", "The connection dropped at 0 MB."], ["step", "Reconnecting (try 1 of 3)"]]);
});

test("signInBrowser: F257: after the third break, the red error then the yellow icon warning (iOS was sent to the link)", async () => {
  const s = server(["drop"]);
  const fetcher = async (url, init = {}) => (new URL(url, "https://ifizbox.example").pathname === "/api/fetch" ? s.fetcher(url, init) : Response.json({ ok: true }));
  // no early link (no profile known at the tap): no icon can be left, so no warning
  const plain = logHud();
  await signInBrowser({ url: "https://a.example/x.ipa", name: "Unbound" }, signDeps(fetcher, { hud: plain.hud }));
  assert.deepEqual(plain.lines.filter(([k]) => k === "error" || k === "warning"), [["error", CUT_TEXT]]);
  assert.equal(plain.lines.filter(([, t]) => /^Reconnecting/.test(t)).length, 3);
  // iOS was sent to the early link (a com.you.* profile and the app's bundle ID known at the tap)
  const profile = new TextEncoder().encode(`<?xml version="1.0"?><plist version="1.0"><dict><key>TeamIdentifier</key><array><string>T1</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>T1.com.you.*</string></dict></dict></plist>`);
  const id = { p12: new Uint8Array([0x30, 1]), profile, password: "pw", passwordOk: true };
  const early = logHud(), opened = [];
  await signInBrowser({ url: "https://a.example/x.ipa", name: "Unbound", bundleId: "com.example.unbound" },
    signDeps(fetcher, { hud: early.hud, now: () => id, identity: async () => id, open: (u) => opened.push(u), origin: () => "https://ifizbox.example" }));
  assert.equal(opened.length, 1);
  assert.deepEqual(early.lines.filter(([k]) => k === "error" || k === "warning"),
    [["error", CUT_TEXT], ["warning", "If a gray Unbound icon was left on your Home Screen, delete it."]]);
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
