// B58: source rows' icons. In the app (a backend with iconBytes) they come from the icon cache as blob: URLs, a
// cached one with no network call; an http icon (BigBoss) through the shell, never as <img src=http://…>. The
// website (no iconBytes) keeps walking the URLs through assetUrl. backend-native's iconBytes: net.icon's bytes and
// error codes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceIconImage, resetSourceIcons } from "./source-icon.js";
import { createNativeBackend } from "./backend-native.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

class FakeImage {
  constructor() { this.attrs = {}; this.classes = new Set(); this.removed = false; this.srcs = []; }
  set src(v) { this.attrs.src = String(v); this.srcs.push(String(v)); }
  get src() { return this.attrs.src ?? ""; }
  getAttribute(n) { return this.attrs[n] ?? null; }
  get classList() { return { add: (c) => this.classes.add(c), contains: (c) => this.classes.has(c) }; }
  remove() { this.removed = true; }
}

function withImage(fn) {
  return async () => {
    const saved = globalThis.Image;
    globalThis.Image = FakeImage;
    resetSourceIcons();
    try { await fn(); } finally { globalThis.Image = saved; resetSourceIcons(); }
  };
}

function mapStore() {
  const rows = new Map();
  return { rows, get: async (k) => structuredClone(rows.get(k)), put: async (r) => { rows.set(r.key, structuredClone(r)); } };
}

const BIGBOSS = ["http://apt.thebigboss.org/repofiles/cydia/dists/stable/CydiaIcon.png", "http://apt.thebigboss.org/repofiles/cydia/CydiaIcon.png"];

test("app: BigBoss' http icon comes through iconBytes as a blob: URL, never an http <img>", withImage(async () => {
  const asked = [];
  const backend = { kind: "native", assetUrl: (u) => u, iconBytes: async (u) => { asked.push(u); return { type: "image/png", bytes: PNG }; } };
  const store = mapStore();
  const img = sourceIconImage("deb:bigboss", BIGBOSS, backend, { store });
  await img.done;
  assert.deepEqual(asked, [BIGBOSS[0]]);
  assert.match(img.src, /^blob:/);
  assert.ok(img.srcs.every((s) => !/^http:/.test(s)), img.srcs.join(" "));
  assert.equal(store.rows.get("deb:bigboss").url, BIGBOSS[0]);
}));

test("app: a cached icon shows with no network call, and a redraw takes it from memory at once", withImage(async () => {
  const store = mapStore();
  store.rows.set("k", { key: "k", url: "https://r.test/CydiaIcon.png", type: "image/png", bytes: PNG, at: Date.now() });
  const backend = { kind: "native", iconBytes: async () => { throw new Error("network asked"); } };
  const img = sourceIconImage("k", ["https://r.test/CydiaIcon.png"], backend, { store });
  await img.done;
  assert.match(img.src, /^blob:/);
  // the list redrawn: the <img> has its picture before any await
  const again = sourceIconImage("k", ["https://r.test/CydiaIcon.png"], backend, { store });
  assert.equal(again.src, img.src);
  await again.done;
  assert.equal(again.srcs.length, 1);
}));

test("app: nothing cached and the shell can't answer: https places load the old way, http ones never", withImage(async () => {
  const backend = { kind: "native", assetUrl: (u) => u, iconBytes: async () => { throw Object.assign(new Error("x"), { code: "network" }); } };
  const img = sourceIconImage("k2", ["http://h.test/dists/a/CydiaIcon.png", "https://h.test/CydiaIcon.png"], backend, { store: mapStore() });
  await img.done;
  assert.deepEqual(img.srcs, ["https://h.test/CydiaIcon.png"]);
  const http = sourceIconImage("k3", ["http://h.test/CydiaIcon.png"], backend, { store: mapStore() });
  await http.done;
  assert.equal(http.removed, true);
  // known to have no icon: a letter, no <img> walk
  const store = mapStore();
  store.rows.set("k4", { key: "k4", none: true, at: Date.now() });
  const none = sourceIconImage("k4", ["https://h.test/CydiaIcon.png"], backend, { store });
  await none.done;
  assert.deepEqual(none.srcs, []);
}));

test("website: no iconBytes, the URLs walk through assetUrl as before", withImage(async () => {
  const backend = { kind: "http", assetUrl: (u) => `/api/fetch?url=${encodeURIComponent(u)}` };
  const img = sourceIconImage("k", ["https://a.test/x/CydiaIcon.png", "https://a.test/CydiaIcon.png"], backend);
  assert.equal(img.src, "/api/fetch?url=" + encodeURIComponent("https://a.test/x/CydiaIcon.png"));
  img.onerror();
  assert.equal(img.src, "/api/fetch?url=" + encodeURIComponent("https://a.test/CydiaIcon.png"));
  img.onerror();
  assert.equal(img.removed, true);
  img.onload();
  assert.equal(img.classList.contains("loaded"), true);
}));

test("backend-native iconBytes: net.icon's bytes; the shell's error code kept", async () => {
  const calls = [];
  const native = {
    call: async (method, params) => {
      calls.push([method, params]);
      if (method !== "net.icon") return null;
      if (params.url.includes("missing")) { throw Object.assign(new Error("not_found: HTTP 404"), { code: "not_found" }); }
      if (params.url.includes("svg")) throw new Error("bad_type: not a PNG or JPEG");
      return { type: "image/png", body: btoa(String.fromCharCode(...PNG)) };
    },
  };
  const b = createNativeBackend({ native, sourceOptions: { mode: "jailbreak", indexedDB: null, coreFoundation: () => "1800" } });
  const r = await b.iconBytes("http://apt.thebigboss.org/repofiles/cydia/dists/stable/CydiaIcon.png");
  assert.equal(r.type, "image/png");
  assert.deepEqual([...r.bytes], [...PNG]);
  assert.deepEqual(calls.find((c) => c[0] === "net.icon")[1], { url: "http://apt.thebigboss.org/repofiles/cydia/dists/stable/CydiaIcon.png" });
  await assert.rejects(b.iconBytes("https://r.test/missing.png"), { code: "not_found" });
  await assert.rejects(b.iconBytes("https://r.test/svg"), { code: "bad_type" });
  await assert.rejects(b.iconBytes("file:///etc/passwd"), { code: "bad_url" });
});
