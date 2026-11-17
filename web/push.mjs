// The node half of Web Push (F10). web/push.py runs it as `node push.mjs <command>` with JSON on stdin and reads
// JSON from stdout. Python keeps the network (every repo fetch goes through fetch.py's SSRF guard) and the store;
// this file does what only JS does here: the upgrade diff, with the same web/app/core/ code the browser runs (no
// Python copy), and the crypto Python's stdlib lacks (P-256 ECDH and ECDSA, AES-GCM), through WebCrypto.
//
//   keys                                   -> { publicKey, privateKey }      a VAPID key pair (base64url raw, JWK)
//   dirs     { sources: [{uri,dist,components}], arch } -> [[dir] | { error }]   each source's Packages directories
//   diff     { files: {dir: path|null}, subscribers: [{ id, arch, sources, installed, holds }] }
//            -> { <id>: { available: [{id,name,version,installed}], ignored: n } }
//   encrypt  { vapid: { publicKey, privateKey, subject }, ttl, messages: [{ endpoint, p256dh, auth, payload }] }
//            -> [{ endpoint, headers, body }]                                body is base64
//
// `installed` is [{id, version, held}]: the little the browser sends on opt-in, not the whole status file.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { webcrypto as crypto } from "node:crypto";
import { repoLayout, DEFAULT_ARCH, ARCHES } from "./app/core/apt.js";
import { createCatalog } from "./app/core/catalog.js";

const subtle = crypto.subtle;
const enc = new TextEncoder();

// ---- base64url --------------------------------------------------------------------------------------------

export const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
export const unb64u = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

// ---- the diff ---------------------------------------------------------------------------------------------

const archOf = (a) => (ARCHES.includes(a) ? a : DEFAULT_ARCH);

// A source's Packages directories for `arch` (what backend.packages() takes): one for a flat repo, one per
// component for a dist repo. A source repoLayout refuses comes back as { error }.
export function packageDirs(source, arch) {
  try {
    return repoLayout(source, archOf(arch)).packages.map((f) => f.slice(0, -"Packages".length));
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// [{id, version, held}] -> a dpkg status file, so the catalog's own setInstalled/upgrades run unchanged.
export function statusText(installed) {
  const out = [];
  for (const p of installed ?? []) {
    if (!p || typeof p.id !== "string" || typeof p.version !== "string") continue;
    const clean = (s) => s.replace(/[\r\n]/g, "");
    out.push(`Package: ${clean(p.id)}\nStatus: ${p.held ? "hold" : "install"} ok installed\nVersion: ${clean(p.version)}\n`);
  }
  return out.join("\n");
}

// One subscriber's upgrades. `textOf(dir)` returns that directory's Packages text, or null when it has none.
// `catalogFor` lets subscribers with the same sources and arch share one loaded catalog (BigBoss is ~30k stanzas).
export function upgradesFor(sub, textOf, catalogFor = () => null) {
  const arch = archOf(sub.arch);
  const sources = Array.isArray(sub.sources) ? sub.sources : [];
  const sig = arch + "\n" + sources.map((s) => `${s.uri} ${s.dist} ${(s.components ?? []).join(",")}`).sort().join("\n");
  let catalog = catalogFor(sig);
  if (!catalog) {
    catalog = createCatalog();
    for (const s of sources) {
      const dirs = packageDirs(s, arch);
      if (!Array.isArray(dirs)) continue;
      const parts = dirs.map(textOf).filter((t) => t != null);
      if (!parts.length) continue;
      catalog.load(s.key ?? `deb:${s.uri}:${s.dist || "./"}`, parts.join("\n\n"), repoLayout(s, arch).root, arch);
    }
    catalogFor(sig, catalog);
  }
  catalog.setInstalled(statusText(sub.installed));
  const { available, ignored } = catalog.upgrades(Array.isArray(sub.holds) ? sub.holds : []);
  return {
    available: available.map(({ id, name, version, installed }) => ({ id, name: name || id, version, installed })),
    ignored: ignored.length,
  };
}

export function diff({ files = {}, subscribers = [] }) {
  const texts = new Map();
  const textOf = (dir) => {
    if (!texts.has(dir)) {
      const path = files[dir];
      texts.set(dir, path ? readFileSync(path, "utf8") : null);
    }
    return texts.get(dir);
  };
  const catalogs = new Map();
  const catalogFor = (sig, c) => (c ? catalogs.set(sig, c) : catalogs.get(sig));
  const out = {};
  for (const sub of subscribers) out[sub.id] = upgradesFor(sub, textOf, catalogFor);
  return out;
}

// ---- VAPID (RFC 8292) -------------------------------------------------------------------------------------

export async function makeKeys() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    publicKey: b64u(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))),
    privateKey: await subtle.exportKey("jwk", pair.privateKey),
  };
}

// The Authorization header for one endpoint: a JWT (ES256) for the push service's origin, valid 12 hours.
export async function vapidHeader(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject,
  })));
  const key = await subtle.importKey("jwk", { ...privateKey, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto's ECDSA signature is r||s, which is what JWS wants.
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

// ---- Message encryption (RFC 8291, aes128gcm of RFC 8188) -------------------------------------------------

async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

// The JWK of a P-256 private key from its raw d and uncompressed public point (for the RFC's test vector).
export function privateJwk(d, publicRaw) {
  const pub = publicRaw instanceof Uint8Array ? publicRaw : unb64u(publicRaw);
  return { kty: "EC", crv: "P-256", d: typeof d === "string" ? d : b64u(d), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
}

// The body for one push: salt(16) | rs(4) | idlen(1) | as_public(65) | ciphertext. `opts.asPrivate` (JWK) and
// `opts.salt` are for tests; normally both are fresh for every message.
export async function encrypt(payload, p256dh, auth, opts = {}) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh key");
  if (authSecret.length < 16) throw new Error("bad auth secret");
  const ecdh = { name: "ECDH", namedCurve: "P-256" };
  let asPrivate;
  let asPublic;
  if (opts.asPrivate) {
    asPrivate = await subtle.importKey("jwk", { ...opts.asPrivate, key_ops: ["deriveBits"] }, ecdh, false, ["deriveBits"]);
    asPublic = concat([4], unb64u(opts.asPrivate.x), unb64u(opts.asPrivate.y));
  } else {
    const pair = await subtle.generateKey(ecdh, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await subtle.importKey("raw", uaPublic, ecdh, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0 || ua_public || as_public, 32)
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, [1]));
  const salt = opts.salt ? unb64u(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
  const plain = concat(enc.encode(payload), [2]); // one record, the last: delimiter 2, no padding
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const rs = 4096;
  return concat(salt, [rs >>> 24, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255], [asPublic.length], asPublic, cipher);
}

// The request for each message. A message that can't be built (a bad key from the browser) gets { error }.
export async function prepare({ vapid, ttl = 86400, messages = [] }) {
  return Promise.all(messages.map(async (m) => {
    try {
      const body = await encrypt(m.payload, m.p256dh, m.auth);
      return {
        endpoint: m.endpoint,
        headers: {
          Authorization: await vapidHeader(m.endpoint, vapid),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(ttl),
          Urgency: "normal",
        },
        body: Buffer.from(body).toString("base64"),
      };
    } catch (e) {
      return { endpoint: m.endpoint, error: String(e?.message ?? e) };
    }
  }));
}

// ---- CLI --------------------------------------------------------------------------------------------------

async function main(cmd) {
  const input = cmd === "keys" ? {} : JSON.parse(readFileSync(0, "utf8") || "{}");
  switch (cmd) {
    case "keys": return makeKeys();
    case "dirs": return (input.sources ?? []).map((s) => packageDirs(s, input.arch));
    case "diff": return diff(input);
    case "encrypt": return prepare(input);
    default: throw new Error(`unknown command ${cmd}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).then(
    (out) => process.stdout.write(JSON.stringify(out)),
    (e) => { process.stderr.write(`push.mjs: ${e?.stack ?? e}\n`); process.exit(1); },
  );
}
