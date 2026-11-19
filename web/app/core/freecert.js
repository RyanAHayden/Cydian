// F254: the free Apple ID route's own development key and certificate, made in the browser (pure JS + WebCrypto).
// The website asks Apple for a development certificate with a CSR whose key never leaves the browser, then packs the
// key and Apple's certificate as a .p12 that zsign (OpenSSL 3) and the app's Signing import read.
//
//   makeKey(subtle)                      -> { privateKey, spki, pkcs8 }: RSA 2048, extractable (the .p12 needs it)
//   await makeCsr({ privateKey, spki, cn, o, c }, subtle)   -> the CSR as PEM (PKCS#10, SHA-256 with RSA)
//   await makeP12({ pkcs8, cert, password, name, iterations }, subtle)   -> .p12 bytes: the certificate (plain bag) and
//                                        the key (PBES2: PBKDF2-HMAC-SHA256 + AES-256-CBC), MAC HMAC-SHA256 with
//                                        PKCS#12's own KDF: OpenSSL 3's `pkcs12 -export` defaults
//   certSpki(cert) / certSerial(cert)    the certificate's public key (DER) and serial (upper-case hex, no leading 0)
//   sameKey(cert, spki)                  is this Apple certificate the one for our key?
//   newPassword()                        a random .p12 password (hex)
//   storedZip([{ name, data }])          a zip with no compression: the hand-off for the app's Select All Files
//   pem(label, der) / unpem(text)
// SPDX-License-Identifier: GPL-3.0-or-later
import { der, children } from "./signing.js";

const te = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

// ---- DER writing ----
function len(n) {
  if (n < 0x80) return Uint8Array.of(n);
  const b = [];
  while (n) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Uint8Array.of(0x80 | b.length, ...b);
}
export const tlv = (tag, ...body) => { const v = concat(...body); return concat(Uint8Array.of(tag), len(v.length), v); };
export const seq = (...b) => tlv(0x30, ...b);
const set = (...b) => tlv(0x31, ...b);
const octets = (b) => tlv(0x04, b);
const nul = () => Uint8Array.of(0x05, 0x00);
const ctx = (n, ...b) => tlv(0xa0 + n, ...b);
function int(n) {
  const b = [];
  do { b.unshift(n & 0xff); n = Math.floor(n / 256); } while (n);
  if (b[0] & 0x80) b.unshift(0);
  return tlv(0x02, Uint8Array.from(b));
}
export function oid(s) {
  const p = s.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const x of p.slice(2)) {
    const b = [x & 0x7f];
    for (let v = Math.floor(x / 128); v; v = Math.floor(v / 128)) b.unshift(0x80 | (v & 0x7f));
    out.push(...b);
  }
  return tlv(0x06, Uint8Array.from(out));
}
const utf8String = (s) => tlv(0x0c, te.encode(s));
const printable = (s) => tlv(0x13, te.encode(s));
function bmp(s) {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) >> 8; b[2 * i + 1] = s.charCodeAt(i) & 0xff; }
  return tlv(0x1e, b);
}

export const OIDS = {
  rsaSha256: "1.2.840.113549.1.1.11", cn: "2.5.4.3", o: "2.5.4.10", c: "2.5.4.6",
  data: "1.2.840.113549.1.7.1", certBag: "1.2.840.113549.1.12.10.1.3", keyBag: "1.2.840.113549.1.12.10.1.2",
  x509: "1.2.840.113549.1.9.22.1", localKeyId: "1.2.840.113549.1.9.21", friendlyName: "1.2.840.113549.1.9.20",
  pbes2: "1.2.840.113549.1.5.13", pbkdf2: "1.2.840.113549.1.5.12", hmacSha256: "1.2.840.113549.2.9",
  aes256cbc: "2.16.840.1.101.3.4.1.42", sha256: "2.16.840.1.101.3.4.2.1",
};

export function pem(label, bytes) {
  let b = "";
  for (const x of bytes) b += String.fromCharCode(x);
  const lines = btoa(b).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}
export function unpem(text) {
  const body = String(text).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

const subtleOf = (s) => s ?? globalThis.crypto?.subtle;
const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" };

export async function makeKey(subtle) {
  const s = subtleOf(subtle);
  const pair = await s.generateKey(RSA, true, ["sign", "verify"]);
  const spki = new Uint8Array(await s.exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(await s.exportKey("pkcs8", pair.privateKey));
  return { privateKey: pair.privateKey, spki, pkcs8 };
}

// Apple ignores the subject (the certificate it makes says "Apple Development: <name>"), but a CSR needs one.
export async function makeCsr({ privateKey, spki, cn = "Development", o = "", c = "US" }, subtle) {
  const s = subtleOf(subtle);
  const rdn = (id, v) => set(seq(oid(id), id === OIDS.c ? printable(v) : utf8String(v)));
  const name = seq(rdn(OIDS.cn, cn), ...(o ? [rdn(OIDS.o, o)] : []), ...(c ? [rdn(OIDS.c, c)] : []));
  const info = seq(int(0), name, spki, ctx(0));
  const sig = new Uint8Array(await s.sign("RSASSA-PKCS1-v1_5", privateKey, info));
  const csr = seq(info, seq(oid(OIDS.rsaSha256), nul()), tlv(0x03, Uint8Array.of(0), sig));
  return pem("CERTIFICATE REQUEST", csr);
}

// ---- reading Apple's certificate ----
function tbsFields(cert) {
  const c = der(cert, 0);
  const [tbs] = children(cert, c);
  let f = children(cert, tbs);
  if (f[0].tag === 0xa0) f = f.slice(1);
  return { f, tbs };
}
// The whole TLV of the node (der() gives the value's start; the header is before it).
function rawTlv(buf, node, from) { return buf.slice(from, node.end); }

export function certSpki(cert) {
  const { f } = tbsFields(cert);
  // serial, signature, issuer, validity, subject, subjectPublicKeyInfo: each starts where the one before ended
  return rawTlv(cert, f[5], f[4].end);
}
export function certSerial(cert) {
  const { f } = tbsFields(cert);
  let hex = "";
  for (let i = f[0].start; i < f[0].end; i++) hex += cert[i].toString(16).padStart(2, "0");
  return hex.replace(/^(00)+(?=.)/, "").toUpperCase();
}
export function sameKey(cert, spki) {
  try {
    const a = certSpki(cert);
    return a.length === spki.length && a.every((x, i) => x === spki[i]);
  } catch { return false; }
}

export function newPassword() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- PKCS#12 ----
// RFC 7292 B.2 for the MAC key (id 3) with SHA-256: u = 32 = the key's length, so one block.
async function macKey(s, password, salt, iterations) {
  const v = 64;
  const pw = new Uint8Array((password.length + 1) * 2);
  for (let i = 0; i < password.length; i++) { pw[2 * i] = password.charCodeAt(i) >> 8; pw[2 * i + 1] = password.charCodeAt(i) & 0xff; }
  const fill = (src) => { const n = v * Math.ceil(src.length / v); const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = src[i % src.length]; return o; };
  let A = concat(new Uint8Array(v).fill(3), fill(salt), fill(pw));
  for (let r = 0; r < iterations; r++) A = new Uint8Array(await s.digest("SHA-256", A));
  return A;
}

// chain: issuer certificates (DER) to carry too. zsign has Apple's WWDR intermediates built in, so an Apple
// Development certificate needs none; a certificate from another CA (the tests' fixture) does.
export async function makeP12({ pkcs8, cert, password, name = "Development", iterations = 2048, chain = [] }, subtle) {
  const s = subtleOf(subtle);
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const keyId = new Uint8Array(await s.digest("SHA-1", cert));
  const attrs = set(seq(oid(OIDS.localKeyId), set(octets(keyId))), seq(oid(OIDS.friendlyName), set(bmp(name))));

  // the key: PBES2 (PBKDF2-HMAC-SHA256, AES-256-CBC); PBES2 takes the password as UTF-8 bytes
  const salt = rand(16), iv = rand(16);
  const base = await s.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveKey"]);
  const aes = await s.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-CBC", length: 256 }, false, ["encrypt"]);
  const enc = new Uint8Array(await s.encrypt({ name: "AES-CBC", iv }, aes, pkcs8));
  const alg = seq(oid(OIDS.pbes2), seq(
    seq(oid(OIDS.pbkdf2), seq(octets(salt), int(iterations), seq(oid(OIDS.hmacSha256), nul()))),
    seq(oid(OIDS.aes256cbc), octets(iv))));
  const keyBag = seq(oid(OIDS.keyBag), ctx(0, seq(alg, octets(enc))), attrs);
  const certBag = seq(oid(OIDS.certBag), ctx(0, seq(oid(OIDS.x509), ctx(0, octets(cert)))), attrs);
  const data = (bytes) => seq(oid(OIDS.data), ctx(0, octets(bytes)));
  const caBags = chain.map((c) => seq(oid(OIDS.certBag), ctx(0, seq(oid(OIDS.x509), ctx(0, octets(c))))));
  const authSafe = seq(data(seq(certBag, ...caBags)), data(seq(keyBag)));

  const macSalt = rand(16);
  const mk = await s.importKey("raw", await macKey(s, password, macSalt, iterations), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await s.sign("HMAC", mk, authSafe));
  return seq(int(3), data(authSafe), seq(seq(seq(oid(OIDS.sha256), nul()), octets(mac)), octets(macSalt), int(iterations)));
}

// ---- a zip with no compression ----
let crcTable = null;
export function crc32(b) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function storedZip(files) {
  const u16 = (n) => Uint8Array.of(n & 0xff, n >>> 8 & 0xff);
  const u32 = (n) => Uint8Array.of(n & 0xff, n >>> 8 & 0xff, n >>> 16 & 0xff, n >>> 24 & 0xff);
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const n = te.encode(name), crc = crc32(data);
    // version 20, flags 0x0800 (UTF-8 names), method 0 (stored), time/date 0 (1980)
    const common = concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(n.length), u16(0));
    const local = concat(u32(0x04034b50), common, n, data);
    centrals.push(concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), n));
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(...centrals);
  return concat(...locals, cd, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0));
}
