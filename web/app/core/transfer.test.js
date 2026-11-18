// F75: Send Settings' link (Open in iFizBox App): encode/decode and what importing would change. F89: no certificate
// and no Signing Server in it any more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeLink, decodeLink, reviewLink, toB64url, fromB64url } from "./transfer.js";
import { TRAVELS } from "./settings.js";

test("base64url both ways, any bytes", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (const n of [0, 1, 2, 3, 31, 32, 256]) assert.deepEqual(fromB64url(toB64url(all.subarray(0, n))), all.subarray(0, n));
  assert.doesNotMatch(toB64url(all), /[+/=]/);
  assert.throws(() => fromB64url("a b"));
});

const SOURCES = ["https://repo.chariz.com/", "deb https://apt.procurs.us/ 1900 main", "https://alt.example/apps.json"];

test("Open in iFizBox App: encode/decode round trip, gzip keeps hundreds of sources inside a URL", async () => {
  const url = await encodeLink({ sources: [...SOURCES, SOURCES[0]], settings: { appearance: "dark" }, holds: ["a"], server: "sign.example.org" });
  assert.match(url, /^ifizbox:\/\/import\?d=[A-Za-z0-9_-]+$/);
  const p = await decodeLink(url);
  assert.deepEqual(p, { v: 1, sources: SOURCES, settings: { appearance: "dark" }, holds: ["a"] }); // F89: no server
  const withCert = await decodeLink(await encodeLink({ identity: { p12: "MAE", profile: "Ag", password: "pw", p12Name: "c.p12", profileName: "p" } }));
  // F93: the website's certificate travels again (Settings > Signing in the browser)
  assert.deepEqual(withCert.identity, { p12: "MAE", profile: "Ag", password: "pw", p12Name: "c.p12", profileName: "p" });
  assert.equal("identity" in (await decodeLink(await encodeLink({ identity: { p12: "", profile: "Ag" } }))), false);
  const many = Array.from({ length: 400 }, (_, i) => `https://repo${i}.example.com/`);
  const big = await encodeLink({ sources: many });
  assert.ok(big.length < 64 * 1024, `${big.length} characters`);
  assert.equal((await decodeLink(big)).sources.length, 400);
});

test("Open in iFizBox App: the shell's gunzip where WebKit has no DecompressionStream", async () => {
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

test("Open in iFizBox App: anything else decodes to null, and the certificate never rides along", async () => {
  for (const bad of ["ifizbox://import", "ifizbox://import?d=!!", "ifizbox://other?d=H4sI", "https://x/?d=H4sI", "ifizbox://import?d=AAAA"]) {
    assert.equal(await decodeLink(bad), null, bad);
  }
  const url = await encodeLink({ sources: SOURCES, p12: "secret", settings: {} });
  assert.equal("p12" in (await decodeLink(url)), false);
});

test("review: only what's new; the user's own sources, settings and holds stay unless imported", async () => {
  const p = await decodeLink(await encodeLink({ sources: [...SOURCES, "https://repo.chariz.com"],
    settings: { appearance: "dark", worksOnMyPhone: true, device: "iphoneos-arm64" }, holds: ["a", "b"] }));
  const mine = { appearance: "light", worksOnMyPhone: true, device: "none" };
  const r = reviewLink(p, {
    have: [{ key: "deb:https://repo.chariz.com/:./" }],
    get: (k) => mine[k], shown: (k) => k !== "device", holds: ["b"],
  });
  assert.deepEqual(r.sources.map((e) => e.uri), ["https://apt.procurs.us/", "https://alt.example/apps.json"]); // chariz listed once already
  assert.deepEqual(r.settings, [{ key: "appearance", from: "light", to: "dark" }]); // same value and hidden ones left out
  assert.deepEqual(r.holds, ["a"]);
  assert.equal("server" in r, false);
  assert.equal(r.empty, false);
  const again = reviewLink(p, { have: r.sources.flatMap((e) => [{ key: "deb:https://repo.chariz.com/:./" }, { key: e.kind === "apt" ? `deb:${e.uri}:${e.dist}` : `alt:${e.uri}` }]),
    get: (k) => ({ ...mine, appearance: "dark" })[k], shown: (k) => k !== "device", holds: ["a", "b"] });
  assert.equal(again.settings.length + again.holds.length, 0);
  assert.equal(reviewLink({ v: 1, sources: [], settings: {}, holds: [], server: "https://mine.example" }).empty, true); // an old link's server

  assert.equal(reviewLink(null).empty, true);
});

test("the settings that travel exist", async () => {
  const { SETTINGS } = await import("./settings.js");
  for (const k of TRAVELS) assert.ok(SETTINGS.some((d) => d.key === k), k);
});
