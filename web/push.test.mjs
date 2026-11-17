// Tests for push.mjs, run by web/test_push.py (node --test web/push.test.mjs) so the gate covers them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { encrypt, privateJwk, vapidHeader, makeKeys, upgradesFor, statusText, packageDirs, b64u, unb64u } from "./push.mjs";

const subtle = crypto.subtle;

// RFC 8291, Appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("encrypt matches RFC 8291's worked example byte for byte", async () => {
  const body = await encrypt(RFC.plaintext, RFC.uaPublic, RFC.auth,
    { asPrivate: privateJwk(RFC.asPrivate, RFC.asPublic), salt: RFC.salt });
  assert.equal(b64u(body), RFC.body);
});

// What the browser does on receipt, written from RFC 8291 section 3.4 and RFC 8188 independently of encrypt().
async function decrypt(body, uaPrivateJwk, uaPublic, auth) {
  const hmac = async (key, data) => new Uint8Array(await subtle.sign("HMAC",
    await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data));
  const cat = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
  const te = new TextEncoder();
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  const priv = await subtle.importKey("jwk", { ...uaPrivateJwk, key_ops: ["deriveBits"] }, ecdh, false, ["deriveBits"]);
  const pub = await subtle.importKey("raw", asPublic, ecdh, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(te.encode("WebPush: info\0"), uaPublic, asPublic, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  assert.equal(plain.at(-1), 2, "last record delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("a fresh message (random key and salt) decrypts to the payload", async () => {
  const payload = JSON.stringify({ title: "Cydian", body: "3 upgrades: Ä, B and C", count: 3 });
  const body = await encrypt(payload, RFC.uaPublic, RFC.auth);
  assert.equal(body.length, 16 + 4 + 1 + 65 + new TextEncoder().encode(payload).length + 1 + 16);
  const got = await decrypt(body, privateJwk(RFC.uaPrivate, RFC.uaPublic), unb64u(RFC.uaPublic), unb64u(RFC.auth));
  assert.equal(got, payload);
});

test("encrypt refuses a key that is not an uncompressed P-256 point", async () => {
  await assert.rejects(encrypt("x", b64u(new Uint8Array(10)), RFC.auth), /p256dh/);
});

test("the VAPID header is an ES256 JWT for the push service's origin that verifies with k", async () => {
  const keys = await makeKeys();
  const now = Date.UTC(2026, 10, 17);
  const h = await vapidHeader("https://web.push.apple.com/QGuQyavXutnMH...?x=1", { ...keys, subject: "https://cydian.example" }, now);
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  assert.equal(m[4], keys.publicKey);
  const claims = JSON.parse(Buffer.from(m[2], "base64url"));
  assert.deepEqual(claims, { aud: "https://web.push.apple.com", exp: now / 1000 + 43200, sub: "https://cydian.example" });
  assert.equal(JSON.parse(Buffer.from(m[1], "base64url")).alg, "ES256");
  const pub = await subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);
});

// ---- the diff ----

const REPO_A = "https://a.example/";
const REPO_B = "https://b.example/";
const pkgs = (...list) => list.map(([id, v, extra = ""]) => `Package: ${id}\nVersion: ${v}\nArchitecture: iphoneos-arm64\nName: ${id.toUpperCase()}\nSection: Tweaks\nFilename: debs/${id}.deb\n${extra}`).join("\n");

test("upgradesFor runs core's catalog: newest version across sources, holds and dpkg holds ignored", () => {
  const texts = {
    [REPO_A]: pkgs(["foo", "1.0"], ["bar", "2.0"], ["held", "9"], ["mine", "5"]),
    [REPO_B]: pkgs(["foo", "1.2"], ["baz", "1:0.1"]),
  };
  const sub = {
    id: "s1", arch: "iphoneos-arm64",
    sources: [{ uri: REPO_A, dist: "./", components: [] }, { uri: REPO_B, dist: "./", components: [] }],
    installed: [
      { id: "foo", version: "1.0" }, { id: "bar", version: "2.0" }, { id: "baz", version: "3.0" },
      { id: "held", version: "1", held: true }, { id: "mine", version: "1" }, { id: "gone", version: "1" },
    ],
    holds: ["mine"],
  };
  const r = upgradesFor(sub, (d) => texts[d] ?? null);
  assert.deepEqual(r.available, [{ id: "baz", name: "BAZ", version: "1:0.1", installed: "3.0" },
    { id: "foo", name: "FOO", version: "1.2", installed: "1.0" }]);
  assert.equal(r.ignored, 2);
});

test("a dist repo is read per component for the subscriber's arch; a missing index counts as empty", () => {
  const src = { uri: "https://apt.example/", dist: "1800", components: ["main", "extra"] };
  assert.deepEqual(packageDirs(src, "iphoneos-arm"), [
    "https://apt.example/dists/1800/main/binary-iphoneos-arm/", "https://apt.example/dists/1800/extra/binary-iphoneos-arm/"]);
  const main = "https://apt.example/dists/1800/main/binary-iphoneos-arm/";
  const text = pkgs(["x", "2"]).replace("iphoneos-arm64", "iphoneos-arm");
  const r = upgradesFor({ arch: "iphoneos-arm", sources: [src], installed: [{ id: "x", version: "1" }] },
    (d) => (d === main ? text : null));
  assert.deepEqual(r.available.map((p) => p.id), ["x"]);
  assert.ok(packageDirs({ uri: "" }, "iphoneos-arm64").error);
});

test("subscribers with the same sources share one catalog, but each gets its own installed list", () => {
  const cache = new Map();
  const catalogFor = (sig, c) => (c ? cache.set(sig, c) : cache.get(sig));
  let reads = 0;
  const textOf = () => { reads++; return pkgs(["foo", "2"]); };
  const src = [{ uri: REPO_A, dist: "./", components: [] }];
  const a = upgradesFor({ sources: src, installed: [{ id: "foo", version: "1" }] }, textOf, catalogFor);
  const b = upgradesFor({ sources: src, installed: [{ id: "foo", version: "2" }] }, textOf, catalogFor);
  assert.equal(reads, 1);
  assert.equal(a.available.length, 1);
  assert.equal(b.available.length, 0);
});

test("statusText can't be smuggled extra fields through a newline", () => {
  const t = statusText([{ id: "a\nStatus: hold ok installed", version: "1" }, { id: 5, version: "1" }]);
  assert.equal(t.split("\n").filter((l) => l.startsWith("Status:")).length, 1);
});
