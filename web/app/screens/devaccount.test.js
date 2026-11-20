// Check Account's line about this iPhone (screens/devaccount.js deviceLine), with a fake App Store Connect request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceLine, PAIR_HINT } from "./devaccount.js";

const A = "00008110-000A1B2C3D4E5F01", B = "00008101-000123456789ABCD", C = "00008030-0011223344556677";

function fakeRequest(devices) {
  const calls = [];
  const request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path.startsWith("/devices")) {
      const m = /filter%5Budid%5D=([^&]+)|filter\[udid\]=([^&]+)/.exec(path);
      const want = m ? decodeURIComponent(m[1] ?? m[2]) : null;
      return { data: devices.filter((d) => !want || d.udid === want).map((d, i) => ({ id: `D${i}`, attributes: { udid: d.udid, status: d.status ?? "ENABLED" } })) };
    }
    if (method === "POST" && path === "/devices") return { data: { id: "NEW" } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { request, calls };
}

test("candidates, all registered and enabled: this iPhone is in the account, nothing is posted", async () => {
  const f = fakeRequest([{ udid: A }, { udid: B }, { udid: C }]);
  const line = await deviceLine(f.request, { candidates: [A, B.toLowerCase(), C] });
  assert.equal(line, "This iPhone is in the account (one of the 3 iPhones in this app's profile).");
  assert.ok(!line.includes("isn't known"));
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"]);
});

test("candidates, some missing or disabled: names them and the real Pairing path", async () => {
  const f = fakeRequest([{ udid: A }, { udid: C, status: "DISABLED" }]);
  const line = await deviceLine(f.request, { candidates: [A, B, C] });
  assert.match(line, /one of the 3 iPhones in this app's profile/);
  assert.match(line, new RegExp(`not in the account: ${B}`));
  assert.match(line, new RegExp(`disabled: ${C}`));
  assert.ok(!line.includes(A), "a registered one isn't named");
  assert.match(line, /Install Apps With: This iPhone, then This iPhone > Pairing/);
  assert.ok(!f.calls.some((c) => c.method === "POST"), "nothing is registered without a known UDID");
});

test("a known UDID is registered when missing, and reported when there", async () => {
  const f = fakeRequest([]);
  assert.equal(await deviceLine(f.request, { udid: A.toLowerCase(), candidates: [A] }), `This iPhone (${A}) was added to the account.`);
  assert.equal(f.calls.at(-1).method, "POST");
  assert.equal(await deviceLine(fakeRequest([{ udid: A }]).request, { udid: A }), "This iPhone is in the account.");
});

test("no UDID and no candidates: the app names Install Apps With: This iPhone > Pairing, the site its own finder", async () => {
  const f = fakeRequest([]);
  assert.equal(await deviceLine(f.request, { app: true }), PAIR_HINT);
  assert.match(PAIR_HINT, /Settings > Installation & Signing.*Install Apps With: This iPhone.*This iPhone > Pairing/);
  assert.match(await deviceLine(f.request, { app: false }), /Find This iPhone's UDID/);
  assert.equal(f.calls.length, 0);
});

// ---- F277: Add API Key's several files, the Issuer ID from the clipboard, the UDID through the website ----
import { readKeyPick, issuerPrefill, prefillField, ISSUER_FULL, udidUnknown, findUdidViaSite, registerUdid, SITE_ORIGIN } from "./devaccount.js";
import { sortKeyFiles, issuerFromText } from "../core/certfiles.js";
import { DOMAIN } from "../brand.js";

const ISSUER = "69a6de7e-1234-47e3-e053-5b8c7c11a4d1";
const P8 = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg\n-----END PRIVATE KEY-----\n";
const file = (name, text) => ({ name, bytes: new TextEncoder().encode(text) });

test("sortKeyFiles: the .p8 by its PEM, the Key ID from its name, the Issuer ID from a .txt beside it", async () => {
  const k = await sortKeyFiles([file("notes.txt", `Issuer ID: ${ISSUER.toUpperCase()}\n`), file("AuthKey_ABC123DEF4.p8", P8)]);
  assert.equal(k.p8.name, "AuthKey_ABC123DEF4.p8");
  assert.equal(k.p8.text, P8);
  assert.equal(k.keyId, "ABC123DEF4");
  assert.equal(k.issuerId, ISSUER, "lowercased");
});

test("sortKeyFiles: a .zip's entries, macOS litter skipped, a renamed key found by content, the Key ID from the note", async () => {
  const unzip = async () => [file("__MACOSX/._AuthKey.p8", P8), file("key/my key.p8", P8), file("key/issuer", `Key ID: ZZZ999YYY8\n${ISSUER}`)];
  const k = await sortKeyFiles([file("asc.zip", "")], { unzip });
  assert.equal(k.p8.name, "my key.p8");
  assert.equal(k.keyId, "ZZZ999YYY8");
  assert.equal(k.issuerId, ISSUER);
});

test("sortKeyFiles: no key, no Issuer ID; readKeyPick says what to pick", async () => {
  const k = await sortKeyFiles([file("readme.txt", "hello"), file("cert.p12", "x")]);
  assert.deepEqual(k, { p8: null, keyId: null, issuerId: null });
  assert.match((await readKeyPick([file("readme.txt", ISSUER)])).error, /AuthKey_<Key ID>\.p8/);
  assert.deepEqual(await readKeyPick([file("AuthKey_ABC123DEF4.p8", P8)]), { p8: P8, keyId: "ABC123DEF4", issuerId: null });
});

test("issuerFromText: an Issuer-labelled UUID first, else the first one; nothing else counts", () => {
  const other = "11111111-2222-3333-4444-555555555555";
  assert.equal(issuerFromText(`Key: ${other}\nissuer = ${ISSUER}`), ISSUER);
  assert.equal(issuerFromText(`  ${ISSUER}  `), ISSUER);
  assert.equal(issuerFromText("https://example.com/"), null);
  assert.equal(issuerFromText(""), null);
  assert.ok(ISSUER_FULL.test(ISSUER) && !ISSUER_FULL.test(`x${ISSUER}`));
});

test("issuerPrefill: the app reads the shell's clipboard, a UUID only", async () => {
  const native = (text) => ({ calls: [], call(m, p) { this.calls.push([m, p]); return Promise.resolve(text); } });
  const n = native(`copied ${ISSUER.toUpperCase()}`);
  assert.equal(await issuerPrefill({ native: n }), ISSUER);
  assert.deepEqual(n.calls, [["clipboard.read", {}]]);
  assert.equal(await issuerPrefill({ native: native("https://example.com") }), null);
  assert.equal(await issuerPrefill({ native: { call: () => Promise.reject(new Error("old shell")) } }), null);
});

test("issuerPrefill: the website reads navigator.clipboard only once clipboard-read is granted", async () => {
  let reads = 0;
  const clipboard = { readText: async () => { reads++; return ISSUER; } };
  const perm = (state) => ({ query: async ({ name }) => { assert.equal(name, "clipboard-read"); return { state }; } });
  const site = { native: { call: null } }; // no bridge
  assert.equal(await issuerPrefill({ ...site, clipboard, permissions: perm("granted") }), ISSUER);
  assert.equal(await issuerPrefill({ ...site, clipboard, permissions: perm("prompt") }), null);
  assert.equal(await issuerPrefill({ ...site, clipboard, permissions: { query: async () => { throw new TypeError("unknown name"); } } }), null);
  assert.equal(await issuerPrefill({ ...site, clipboard, permissions: undefined }), null, "Safari: no Permissions answer, no read");
  assert.equal(reads, 1);
});

test("prefillField: fills an empty, untouched field; never over typing", async () => {
  const field = () => {
    const f = { value: "", isConnected: true, on: null, addEventListener(_t, h) { this.on = h; } };
    return f;
  };
  const a = field();
  assert.equal(await prefillField(a, null, async () => ISSUER), true);
  assert.equal(a.value, ISSUER);
  const b = field();
  const p = prefillField(b, null, async () => { b.value = "6"; b.on(); return ISSUER; });
  assert.equal(await p, false);
  assert.equal(b.value, "6");
  const c = field();
  c.isConnected = false;
  assert.equal(await prefillField(c, null, async () => ISSUER), false);
  assert.equal(await prefillField(field(), null, async () => null), false);
});

test("udidUnknown: only when there's no UDID and the line doesn't put this iPhone in the account", () => {
  assert.equal(udidUnknown(null, PAIR_HINT), true);
  assert.equal(udidUnknown(null, "This iPhone is one of the 2 iPhones in this app's profile. Of those, not in the account: X."), true);
  assert.equal(udidUnknown(null, "This iPhone is in the account (the iPhone in this app's profile)."), false);
  assert.equal(udidUnknown(A, PAIR_HINT), false);
});

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("findUdidViaSite: starts the visit on the website, opens it in Safari, registers the UDID the poll brings", async () => {
  assert.equal(SITE_ORIGIN, `https://${DOMAIN}`);
  const store = memStore();
  const fetched = [];
  const fetcher = async (url, init) => {
    fetched.push([url, init?.method ?? "GET"]);
    return { ok: true, status: 200, json: async () => ({ challenge: "c".repeat(32), profile: `${SITE_ORIGIN}/sign/udid/c/udid.mobileconfig`, poll: `${SITE_ORIGIN}/sign/udid/c`, expiresIn: 600 }) };
  };
  const opened = [];
  let onDone = null;
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return null; } };
  const f = fakeRequest([]);
  const alerts = [];
  const ok = await findUdidViaSite(native, { fetcher, store, open: async (u) => { opened.push(u); return true; },
    watch: (cb) => { onDone = cb; return true; }, request: f.request, alert: async (t, m) => { alerts.push([t, m]); } });
  assert.equal(ok, true);
  assert.deepEqual(fetched, [[`${SITE_ORIGIN}/sign/udid`, "POST"]]);
  assert.deepEqual(opened, [`${SITE_ORIGIN}/sign/udid/c/udid.mobileconfig`]);
  // the poll saved it (screens/signing.js pollUdid), then the watcher calls back
  store.setItem("ifizbox.udid", JSON.stringify({ udid: A, product: "iPhone18,1", version: "27.0" }));
  await onDone();
  assert.deepEqual(calls, [["device.udid.set", { udid: A }]]);
  assert.equal(f.calls.at(-1).method, "POST", "registered in the account");
  assert.deepEqual(alerts, [["Developer Account", `This iPhone (${A}) was added to the account.`]]);
});

test("findUdidViaSite: Safari not opened shows the link; the server's error throws", async () => {
  const store = memStore();
  const good = async () => ({ ok: true, status: 200, json: async () => ({ challenge: "c", profile: "https://x/p", poll: "https://x/c" }) });
  const alerts = [];
  const ok = await findUdidViaSite({ call: async () => ({ opened: false }) }, { fetcher: good, store, watch: () => assert.fail("no watch"),
    alert: async (t, m) => { alerts.push([t, m]); } });
  assert.equal(ok, false);
  assert.match(alerts[0][1], /https:\/\/x\/p/);
  const bad = async () => ({ ok: false, status: 503, json: async () => ({ error: "Down." }) });
  await assert.rejects(findUdidViaSite({ call: async () => null }, { fetcher: bad, store }), /Down\./);
});

test("registerUdid: an older shell without device.udid.set still registers it", async () => {
  const f = fakeRequest([{ udid: A }]);
  const line = await registerUdid({ call: async () => { throw new Error("unknown method"); } }, A, { request: f.request });
  assert.equal(line, "This iPhone is in the account.");
});
