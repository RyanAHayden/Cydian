// F197: the website's Add > Choose File: a picked IPA is read in the browser (core/ipainfo.js readIpaFile), kept in
// IndexedDB (core/myipas.js), listed in My IPAs, signed from its bytes on Install (signInBrowser, no download), and
// freed by Delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readIpaFile, parseBplist } from "../core/ipainfo.js";
import { addSiteFile, removeSiteEntry, memoryIpaStore, siteEntries, libraryRows, SITE_FILE_MAX } from "../core/myipas.js";
import { signInBrowser } from "../signing-client.js";
import { addPickedFile, siteFileInstall } from "./myipas.js";

// A zip with stored or deflated entries, as a phone's or a Mac's.
function zip(files) {
  const enc = new TextEncoder();
  const locals = [], dir = [];
  let at = 0;
  for (const [name, data, deflate] of files) {
    const n = enc.encode(name), raw = data instanceof Uint8Array ? data : enc.encode(data);
    const body = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const h = new Uint8Array(30 + n.length), v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(8, deflate ? 8 : 0, true);
    v.setUint32(18, body.length, true); v.setUint32(22, raw.length, true); v.setUint16(26, n.length, true); h.set(n, 30);
    const c = new Uint8Array(46 + n.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, body.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, at, true); c.set(n, 46);
    locals.push(h, body); dir.push(c);
    at += h.length + body.length;
  }
  const dirLen = dir.reduce((s, c) => s + c.length, 0);
  const e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, dir.length, true); ev.setUint16(10, dir.length, true);
  ev.setUint32(12, dirLen, true); ev.setUint32(16, at, true);
  return new Uint8Array(Buffer.concat([...locals, ...dir, e]));
}

// A binary plist of a flat dict (strings, arrays of strings), as Xcode writes Info.plist.
function bplist(dict) {
  const objs = [], ref = (o) => { objs.push(o); return objs.length - 1; };
  const top = ref(null);
  const enc = (v) => (Array.isArray(v) ? { arr: v.map((x) => ref(enc(x))) } : String(v));
  const keys = Object.keys(dict).map((k) => ref(k)), vals = Object.values(dict).map((v) => ref(enc(v)));
  objs[top] = { keys, vals };
  const out = [...Buffer.from("bplist00")], offsets = [];
  const len = (hi, n) => (n < 15 ? [hi << 4 | n] : [hi << 4 | 15, 0x10, n]);
  for (const o of objs) {
    offsets.push(out.length);
    if (typeof o === "string") out.push(...len(5, o.length), ...Buffer.from(o, "latin1"));
    else if (o.arr) out.push(...len(0xa, o.arr.length), ...o.arr);
    else out.push(...len(0xd, o.keys.length), ...o.keys, ...o.vals);
  }
  const table = out.length;
  for (const off of offsets) out.push(off >> 8, off & 255);
  const t = new Uint8Array(32), tv = new DataView(t.buffer);
  t[6] = 2; t[7] = 1; tv.setBigUint64(8, BigInt(objs.length)); tv.setBigUint64(16, 0n); tv.setBigUint64(24, BigInt(table));
  return new Uint8Array([...out, ...t]);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const CGBI = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 4, 0x43, 0x67, 0x42, 0x49, 9, 9, 9, 9, 9]);
const info = { CFBundleIdentifier: "io.dev.delta", CFBundleDisplayName: "Delta", CFBundleShortVersionString: "1.5", MinimumOSVersion: "14.0",
  CFBundleIconFiles: ["AppIcon60x60"] };
const ipa = () => zip([["Payload/", ""], ["Payload/Delta.app/Info.plist", bplist(info), true],
  ["Payload/Delta.app/AppIcon60x60@2x.png", PNG, false], ["Payload/Delta.app/AppIcon60x60@3x.png", CGBI, true], ["Payload/Delta.app/Delta", "bin", true]]);
const fileOf = (bytes, name = "Delta.ipa") => new File([bytes], name);
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("parseBplist reads Xcode's binary Info.plist", () => {
  assert.deepEqual(parseBplist(bplist({ a: "b", list: ["x", "y"] })), { a: "b", list: ["x", "y"] });
  assert.throws(() => parseBplist(new Uint8Array(50)), /header/);
});

test("readIpaFile: name, bundle ID, version, iOS and a drawable icon, from a File or bytes", async () => {
  const want = { bundleId: "io.dev.delta", name: "Delta", version: "1.5", minimumOS: "14.0", icon: Buffer.from(PNG).toString("base64") };
  assert.deepEqual(await readIpaFile(fileOf(ipa())), want); // the CgBI @3x (larger) is skipped: a browser can't draw it
  assert.deepEqual(await readIpaFile(ipa()), want);
  const xml = zip([["Payload/X.app/Info.plist", `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.x</string>
<key>CFBundleName</key><string>X</string></dict></plist>`, true]]);
  assert.deepEqual(await readIpaFile(xml), { bundleId: "com.x", name: "X", version: "", minimumOS: null, icon: null });
  await assert.rejects(readIpaFile(new TextEncoder().encode("not a zip at all, sorry".repeat(3))), { code: "bad_ipa" });
  await assert.rejects(readIpaFile(zip([["readme.txt", "hi"]])), /no Payload/);
});

test("a picked file becomes a My IPAs row, its bytes kept", async () => {
  const storage = memStorage(), store = memoryIpaStore();
  const f = fileOf(ipa());
  const e = await addSiteFile(f, { storage, store, read: readIpaFile, now: Date.UTC(2026, 10, 18) });
  assert.equal(e.file, "Delta.ipa");
  assert.equal(store.files.get("Delta.ipa"), f);
  const again = await addSiteFile(fileOf(ipa()), { storage, store, read: readIpaFile });
  assert.equal(again.file, "Delta 2.ipa");
  const rows = libraryRows(siteEntries(storage), { site: true });
  assert.deepEqual(rows.map((r) => [r.title, r.state.kind]), [["Delta", "file"], ["Delta", "file"]]);
  assert.match(rows[0].subtitle, /^1\.5 · .+ · Kept in this browser/);
  assert.equal(rows[0].bundleId, "io.dev.delta");
  assert.ok(rows[0].icon);
});

test("Choose File refuses what isn't an IPA, is too big, or doesn't fit Safari's storage, with a clear reason", async () => {
  const storage = memStorage(), store = memoryIpaStore();
  const read = readIpaFile;
  await assert.rejects(addSiteFile(fileOf(ipa(), "notes.txt"), { storage, store, read }), /isn't an IPA/);
  await assert.rejects(addSiteFile({ name: "Huge.ipa", size: SITE_FILE_MAX + 1 }, { storage, store, read }), /up to 400 MB.*From URL/);
  await assert.rejects(addSiteFile(fileOf(ipa()), { storage, store, read, room: async () => 1000 }), /no room/);
  const full = { ...memoryIpaStore(), put: async () => { throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); } };
  await assert.rejects(addSiteFile(fileOf(ipa()), { storage, store: full, read }), /no room/);
  assert.deepEqual(siteEntries(storage), []); // nothing half-added
  assert.equal(store.files.size, 0);
  // the screen's Add: the alert says why, the list stays as it was
  const alerts = [];
  const r = await addPickedFile(fileOf(ipa(), "x.zip"), { store, alert: async (a) => { alerts.push(a); return { index: 0 }; }, hud: () => () => {}, open: () => {} });
  assert.equal(r, null);
  assert.equal(alerts[0].title, "Couldn't Add");
});

test("Install hands the kept bytes to the signer: no downloadIpa, same early link and upload", async () => {
  const bytes = ipa();
  const store = memoryIpaStore();
  await store.put("Delta.ipa", fileOf(bytes));
  let asked = null;
  await siteFileInstall({ file: "Delta.ipa", name: "Delta", bundleId: "io.dev.delta", version: "1.5", stored: true },
    { store, sign: async (o) => { asked = o; } });
  assert.equal(asked.url, undefined);
  assert.equal(asked.bundleId, "io.dev.delta");
  const got = await asked.bytes();
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), bytes);

  // signInBrowser with those bytes: nothing goes to /api/fetch; the worker gets the IPA; the early link opens first.
  const paths = [];
  const json = (b) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://site.example");
    paths.push(u.pathname);
    if (u.pathname === "/sign/upload") return u.searchParams.has("size") ? json({ token: u.searchParams.get("token") ?? "t", partSize: 1 << 20, parts: 1 }) : json({ reserved: true });
    if (u.pathname.endsWith("/done")) return json({ itms: "itms-services://x" });
    if (u.pathname.endsWith("/status")) return json({ manifest: true, started: true, finished: true });
    return json({ ok: true });
  };
  const profile = new TextEncoder().encode(`<?xml version="1.0"?><plist version="1.0"><dict><key>TeamIdentifier</key><array><string>T</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>T.*</string></dict></dict></plist>`);
  const id = { p12: new Uint8Array([0x30, 1]), profile, password: "" };
  const order = [];
  let signedInput = null;
  const ok = await signInBrowser({ name: "Delta", bundleId: "io.dev.delta", version: "1.5", bytes: asked.bytes }, {
    hud: (t) => { order.push(t); return { set: () => {}, hide: () => {}, done: () => {} }; },
    alert: async () => ({ index: 0 }), open: (u) => order.push(u.startsWith("itms-services") ? "open" : u), go: () => {},
    now: () => id, identity: async () => id, fetcher, origin: () => "https://site.example", transfer: async () => null,
    worker: async (job) => { signedInput = new Uint8Array(job.ipa); return { ipa: new Uint8Array([1, 2]), bundleId: "io.dev.delta", name: "Delta", version: "1.5" }; },
    watch: () => ({ first: Promise.resolve() }),
  });
  assert.equal(ok, true);
  assert.deepEqual(order.slice(0, 2), ["open", "Reading"]);
  assert.deepEqual(signedInput, bytes);
  assert.ok(!paths.includes("/api/fetch"), paths.join(" "));
  assert.ok(paths.some((p) => p.endsWith("/done")));
});

test("Install of a kept IPA Safari has cleared says so", async () => {
  const alerts = [];
  const id = { p12: new Uint8Array([0x30, 1]), profile: new Uint8Array([1]), password: "" };
  const ok = await signInBrowser({ name: "Delta", bytes: async () => null }, {
    hud: () => ({ set: () => {}, hide: () => {} }), alert: async (a) => { alerts.push(a.message); return { index: 0 }; },
    open: () => {}, now: () => null, identity: async () => id, fetcher: async () => { throw new Error("no fetch"); }, worker: async () => { throw new Error("no"); },
  });
  assert.equal(ok, false);
  assert.match(alerts[0], /isn't kept in this browser/);
});

test("Delete frees the kept bytes", async () => {
  const storage = memStorage(), store = memoryIpaStore();
  const e = await addSiteFile(fileOf(ipa()), { storage, store, read: readIpaFile });
  assert.equal(store.files.size, 1);
  await removeSiteEntry(e, { storage, store });
  assert.equal(store.files.size, 0);
  assert.deepEqual(siteEntries(storage), []);
  // a link entry has no bytes to free
  storage.setItem("ifizbox.myIpas", JSON.stringify([{ file: "L.ipa", url: "https://x/L.ipa" }]));
  await removeSiteEntry({ file: "L.ipa", url: "https://x/L.ipa" }, { storage, store: null });
  assert.deepEqual(siteEntries(storage), []);
});
