// F75: Import from Safari's encrypt/decrypt round trip (the website's export page seals, the app opens, the same
// WebCrypto AES-GCM here in node) and Open in Cydian App's link: encode/decode and what importing would change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newKey, exportUrl, exportKey, sealIdentity, openIdentity, importUrl, sealedFrom, encodeLink, decodeLink,
  reviewLink, toB64url, fromB64url } from "./transfer.js";
import { TRAVELS } from "./settings.js";

const ID = { p12: Uint8Array.from([0x30, 0x82, 1, 2, 3, 250, 251]), profile: new Uint8Array(5000).map((_, i) => i % 251),
  password: "hünter 2", p12Name: "Me.p12", profileName: "Me.mobileprovision" };

test("base64url both ways, any bytes", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (const n of [0, 1, 2, 3, 31, 32, 256]) assert.deepEqual(fromB64url(toB64url(all.subarray(0, n))), all.subarray(0, n));
  assert.doesNotMatch(toB64url(all), /[+/=]/);
  assert.throws(() => fromB64url("a b"));
});

test("a new key is 256 random bits, and rides in the export route's fragment", () => {
  const k = newKey();
  assert.match(k, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fromB64url(k).length, 32);
  assert.notEqual(newKey(), k);
  const url = exportUrl("https://cydian.dev/", k);
  assert.equal(url, `https://cydian.dev/#/settings/signing-export.${k}`);
  const u = new URL(url);
  assert.equal(u.pathname + u.search, "/"); // nothing of the key outside the fragment
  assert.equal(exportKey(u.hash.split("/").pop()), k);
  for (const bad of ["signing-export.short", "signing-export." + k + "x", "signing", null, "export." + k]) assert.equal(exportKey(bad), null);
});

test("Import from Safari: the export page's seal opens in the app with the same key", async () => {
  const key = newKey();
  const sealed = await sealIdentity(ID, key);
  assert.match(sealed, /^[A-Za-z0-9_-]+$/);
  const link = importUrl(sealed);
  assert.equal(sealedFrom(link), sealed);
  assert.equal(link.includes(key), false);
  // nothing readable travels: neither the password nor the file names
  assert.equal(new TextDecoder("latin1").decode(fromB64url(sealed)).includes("Me.p12"), false);
  const back = await openIdentity(sealedFrom(link), key);
  assert.deepEqual(back, ID);
  // fresh IV each time
  assert.notEqual(await sealIdentity(ID, key), sealed);
});

test("Import from Safari: a wrong key, a changed byte or a cut link don't open", async () => {
  const key = newKey();
  const sealed = await sealIdentity(ID, key);
  await assert.rejects(openIdentity(sealed, newKey()));
  const b = fromB64url(sealed);
  b[20] ^= 1;
  await assert.rejects(openIdentity(toB64url(b), key));
  await assert.rejects(openIdentity(sealed.slice(0, 20), key));
  await assert.rejects(openIdentity(sealed, "not a key"));
  await assert.rejects(sealIdentity({ p12: ID.p12 }, key), /no certificate/);
  assert.equal(sealedFrom("cydian://import?d=x"), null);
  assert.equal(sealedFrom("cydian://signing-import#a b"), null);
});

test("the app's decrypt is plain WebCrypto: a seal made by hand opens", async () => {
  const key = newKey();
  const iv = new Uint8Array(12).fill(7);
  const json = JSON.stringify({ v: 1, p12: toB64url(ID.p12), profile: toB64url(ID.profile), password: "pw" });
  const k = await crypto.subtle.importKey("raw", fromB64url(key), { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(json)));
  const back = await openIdentity(toB64url(new Uint8Array([...iv, ...ct])), key);
  assert.deepEqual([back.p12, back.password, back.p12Name], [ID.p12, "pw", "Certificate.p12"]);
  assert.equal(await sealIdentity(ID, key, { iv }).then((s) => fromB64url(s).subarray(0, 12).join()), iv.join());
});

const SOURCES = ["https://repo.chariz.com/", "deb https://apt.procurs.us/ 1900 main", "https://alt.example/apps.json"];

test("Open in Cydian App: encode/decode round trip, gzip keeps hundreds of sources inside a URL", async () => {
  const url = await encodeLink({ sources: [...SOURCES, SOURCES[0]], settings: { appearance: "dark" }, holds: ["a"], server: "sign.example.org" });
  assert.match(url, /^cydian:\/\/import\?d=[A-Za-z0-9_-]+$/);
  const p = await decodeLink(url);
  assert.deepEqual(p, { v: 1, sources: SOURCES, settings: { appearance: "dark" }, holds: ["a"], server: "https://sign.example.org", identity: null });
  const withCert = await decodeLink(await encodeLink({ identity: { p12: "MAE", profile: "Ag", password: "pw", p12Name: "c.p12", profileName: "p" } }));
  assert.deepEqual(withCert.identity, { p12: "MAE", profile: "Ag", password: "pw", p12Name: "c.p12", profileName: "p" }); // the certificate travels too
  const many = Array.from({ length: 400 }, (_, i) => `https://repo${i}.example.com/`);
  const big = await encodeLink({ sources: many });
  assert.ok(big.length < 64 * 1024, `${big.length} characters`);
  assert.equal((await decodeLink(big)).sources.length, 400);
});

test("Open in Cydian App: the shell's gunzip where WebKit has no DecompressionStream", async () => {
  const url = await encodeLink({ sources: SOURCES });
  const saved = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    assert.equal(await decodeLink(url), null); // nothing to gunzip with
    const { gunzipSync } = await import("node:zlib");
    const p = await decodeLink(url, { gunzip: async (b) => gunzipSync(b).toString("utf8") });
    assert.deepEqual(p.sources, SOURCES);
  } finally { globalThis.DecompressionStream = saved; }
});

test("Open in Cydian App: anything else decodes to null, and the certificate never rides along", async () => {
  for (const bad of ["cydian://import", "cydian://import?d=!!", "cydian://other?d=H4sI", "https://x/?d=H4sI", "cydian://import?d=AAAA"]) {
    assert.equal(await decodeLink(bad), null, bad);
  }
  const url = await encodeLink({ sources: SOURCES, p12: "secret", settings: {} });
  assert.equal("p12" in (await decodeLink(url)), false);
});

test("review: only what's new; the user's own sources, settings, holds and server stay unless imported", async () => {
  const p = await decodeLink(await encodeLink({ sources: [...SOURCES, "https://repo.chariz.com"],
    settings: { appearance: "dark", worksOnMyPhone: true, device: "iphoneos-arm64" }, holds: ["a", "b"], server: "https://cydian.dev" }));
  const mine = { appearance: "light", worksOnMyPhone: true, device: "none" };
  const r = reviewLink(p, {
    have: [{ key: "deb:https://repo.chariz.com/:./" }],
    get: (k) => mine[k], shown: (k) => k !== "device", holds: ["b"], server: "https://cydian.dev",
  });
  assert.deepEqual(r.sources.map((e) => e.uri), ["https://apt.procurs.us/", "https://alt.example/apps.json"]); // chariz listed once already
  assert.deepEqual(r.settings, [{ key: "appearance", from: "light", to: "dark" }]); // same value and hidden ones left out
  assert.deepEqual(r.holds, ["a"]);
  assert.equal(r.server, null);
  assert.equal(r.empty, false);
  const again = reviewLink(p, { have: r.sources.flatMap((e) => [{ key: "deb:https://repo.chariz.com/:./" }, { key: e.kind === "apt" ? `deb:${e.uri}:${e.dist}` : `alt:${e.uri}` }]),
    get: (k) => ({ ...mine, appearance: "dark" })[k], shown: (k) => k !== "device", holds: ["a", "b"], server: "https://cydian.dev" });
  assert.equal(again.settings.length + again.holds.length, 0);
  const srv = reviewLink({ server: "https://mine.example" }, { server: "https://cydian.dev" });
  assert.deepEqual(srv.server, { from: "https://cydian.dev", to: "https://mine.example" });
  assert.equal(reviewLink(null).empty, true);
});

test("the settings that travel exist", async () => {
  const { SETTINGS } = await import("./settings.js");
  for (const k of TRAVELS) assert.ok(SETTINGS.some((d) => d.key === k), k);
});
