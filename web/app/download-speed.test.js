// B262: an IPA's download shows its bytes, percent and MB/s: the shell's once-a-second numbers reach the run's row
// (signing/queue.js prepareOnDevice) and Install's progress page (signing/route.js), and the website's fetch puts them on its progress page's label and Log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadIpa, installOnDevice, prepareOnDevice, signInBrowser } from "./signing-client.js";

const MB = 1048576;

test("prepareOnDevice: the shell's download numbers go to the row, its lines to the Log", async () => {
  const native = {
    mode: "sideload",
    async call(m, params, onEvent) {
      if (m !== "signing.prepare") return null;
      onEvent({ log: "Downloading https://a.example/x.ipa" });
      onEvent({ phase: "downloading", progress: 0.1 });
      onEvent({ phase: "downloading", progress: 0.1, bytes: 30 * MB, total: 300 * MB, rate: 21 * MB });
      onEvent({ log: "Downloaded 30.0 of 300.0 MB (10%), 21.0 MB/s" });
      return { token: "t" };
    },
  };
  const seen = [], lines = [];
  await prepareOnDevice({ id: "a", url: "https://a.example/x.ipa" }, { tag: "a", native, progress: (...a) => seen.push(a), log: (l) => lines.push(l) });
  assert.deepEqual(seen, [["downloading", 0.1, "downloading"],
    ["downloading", 0.1, "downloading", { bytes: 30 * MB, total: 300 * MB, rate: 21 * MB }]]);
  assert.deepEqual(lines, ["Downloading https://a.example/x.ipa", "Downloaded 30.0 of 300.0 MB (10%), 21.0 MB/s"]);
});

test("Install's progress page: the download's MB/s stays on the label between the shell's ticks", async () => {
  const saved = globalThis.ifizboxNative;
  const labels = [], raws = [];
  const native = {
    mode: "sideload",
    async call(m, params, onEvent) {
      if (m !== "signing.install") return null;
      onEvent({ phase: "downloading", progress: 0.1 });
      onEvent({ phase: "downloading", progress: 0.1, bytes: 30 * MB, total: 300 * MB, rate: 21 * MB });
      onEvent({ log: "Downloaded 30.0 of 300.0 MB (10%), 21.0 MB/s" });
      onEvent({ phase: "downloading", progress: 0.11 });
      onEvent({ phase: "signing", progress: 0.5 });
      return { bundleId: "com.x", name: "X", version: "1", removed: [] };
    },
  };
  try {
    globalThis.ifizboxNative = native;
    await installOnDevice({ url: "https://e.example/x.ipa", name: "X" }, {
      native, alert: async () => ({ index: 0 }), go: () => {}, later: () => {}, follow: () => {},
      hud: (t) => { labels.push(t); return { set: (x) => labels.push(x), hide() {}, page: { raw: (l) => raws.push(l) } }; },
    });
  } finally { globalThis.ifizboxNative = saved; }
  assert.deepEqual(labels.slice(0, 5), ["Downloading", "Downloading 10%", "Downloading 10%, 21.0 MB/s", "Downloading 11%, 21.0 MB/s", "Signing 50%"]);
  assert.deepEqual(raws, ["Downloaded 30.0 of 300.0 MB (10%), 21.0 MB/s"]);
});

// A body of `parts` pieces of `size` bytes, the length in X-IPA-Length; `step` moves the fake clock per piece read.
function server(parts, size, step) {
  return async () => {
    let i = 0;
    const body = new ReadableStream({
      pull(c) { if (i++ < parts) { step(); c.enqueue(new Uint8Array(size)); } else c.close(); },
    });
    return new Response(body, { headers: { "X-IPA-Length": String(parts * size) } });
  };
}

test("downloadIpa: onBytes after each piece, with the total", async () => {
  const seen = [];
  await downloadIpa("https://a.example/x.ipa", { fetcher: server(3, 4, () => {}), onBytes: (n, t) => seen.push([n, t]) });
  assert.deepEqual(seen, [[4, 12], [8, 12], [12, 12]]);
});

test("signInBrowser: the label carries MB/s and the Log gets a line once a second", async () => {
  let t = 0;
  const labels = [], raws = [];
  const api = server(4, MB, () => {}); // the stream reads ahead, so the clock moves on each look instead
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    if (u.pathname === "/api/fetch") return api(url, init);
    if (u.pathname === "/sign/upload") return Response.json({ token: "t0k", partSize: 64, parts: 1 });
    if (u.pathname === "/sign/upload/t0k/0") return Response.json({ ok: true });
    if (u.pathname === "/sign/upload/t0k/done") return Response.json({ itms: "itms-services://?action=download-manifest&url=x" });
    return Response.json({ error: "no" }, { status: 404 });
  };
  await signInBrowser({ url: "https://a.example/x.ipa", name: "X" }, {
    hud: () => ({ set: (l) => labels.push(l), hide() {}, page: { raw: (l) => raws.push(l) } }),
    alert: async () => ({ index: 1 }), open: () => {}, clock: () => (t += 1000),
    identity: async () => ({ p12: new Uint8Array([1]), profile: new Uint8Array([2]), password: "" }),
    now: () => null, fetcher, transfer: async () => null,
    worker: async () => ({ ipa: new Uint8Array([0x50, 0x4b]), bundleId: "a.b", name: "X", version: "1" }),
  });
  assert.deepEqual(raws.filter((l) => l.startsWith("Downloaded")), [
    "Downloaded 2.0 of 4.0 MB (50%), 1.0 MB/s",
    "Downloaded 3.0 of 4.0 MB (75%), 1.0 MB/s",
    "Downloaded 4.0 of 4.0 MB (100%), 1.0 MB/s",
  ]);
  assert.ok(labels.includes("Downloading 50%, 1.0 MB/s"), labels.join(" | "));
});
