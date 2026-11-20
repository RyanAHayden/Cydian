// The certificate inside a .p12, read in the browser (pure JS + WebCrypto), so the website knows which certificate it
// signs with without asking zsign. The certificate bags are usually encrypted with the .p12's password:
//   PBES2 (PBKDF2 + AES-CBC, OpenSSL 3's default)     WebCrypto
//   pbeWithSHA1And3-KeyTripleDES-CBC (macOS Keychain, OpenSSL -legacy), pbeWithSHA1And40/128BitRC2-CBC (older
//   exports)                                         PKCS#12's own KDF, with DES and RC2 here (WebCrypto has neither)
//
//   await p12Certificates(bytes, password, subtle)   -> [{ cert (DER), keyId (localKeyId) | null }], or null when the
//                                                      file can't be opened here (wrong password, BER, another cipher)
//   await p12Serial(bytes, password, subtle)         -> the signing certificate's serial (upper-case hex, as
//                                                      freecert.js certSerial and asc.js profileSerials spell it) | null
//   await p12Leaf(bytes, password, subtle)           -> { serial, team } of that certificate | null
//   p12LeafCert(certs, keyIds)                       -> the one paired with the private key
// SPDX-License-Identifier: GPL-3.0-or-later
import { der, children, oidString, bmpPassword, pkcs12Kdf, parseCert } from "./signing.js";
import { certSerial } from "./freecert.js";

const bytesOf = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const OID = {
  data: "1.2.840.113549.1.7.1", encryptedData: "1.2.840.113549.1.7.6",
  keyBag: "1.2.840.113549.1.12.10.1.1", shroudedKeyBag: "1.2.840.113549.1.12.10.1.2", certBag: "1.2.840.113549.1.12.10.1.3",
  x509: "1.2.840.113549.1.9.22.1", localKeyId: "1.2.840.113549.1.9.21",
  pbe3des: "1.2.840.113549.1.12.1.3", pbeRc2_128: "1.2.840.113549.1.12.1.5", pbeRc2_40: "1.2.840.113549.1.12.1.6",
  pbes2: "1.2.840.113549.1.5.13", pbkdf2: "1.2.840.113549.1.5.12",
  aes128: "2.16.840.1.101.3.4.1.2", aes192: "2.16.840.1.101.3.4.1.22", aes256: "2.16.840.1.101.3.4.1.42",
  desEde3: "1.2.840.113549.3.7",
};
const PRF = { "1.2.840.113549.2.7": "SHA-1", "1.2.840.113549.2.9": "SHA-256", "1.2.840.113549.2.10": "SHA-384", "1.2.840.113549.2.11": "SHA-512" };
const SHA1 = { name: "SHA-1", u: 20, v: 64 };
const intOf = (b, n) => { let v = 0; for (let i = n.start; i < n.end; i++) v = v * 256 + b[i]; return v; };
const value = (b, n) => b.slice(n.start, n.end);
const same = (a, c) => a && c && a.length === c.length && a.every((x, i) => x === c[i]);

// ---- DES (FIPS 46-3), decryption only; bit arrays: slow, but a certificate bag is a few hundred blocks ----
const IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
const FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
const E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21,
  22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
const P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
const PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
const PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const SBOX = [
  "14 4 13 1 2 15 11 8 3 10 6 12 5 9 0 7 0 15 7 4 14 2 13 1 10 6 12 11 9 5 3 8 4 1 14 8 13 6 2 11 15 12 9 7 3 10 5 0 15 12 8 2 4 9 1 7 5 11 3 14 10 0 6 13",
  "15 1 8 14 6 11 3 4 9 7 2 13 12 0 5 10 3 13 4 7 15 2 8 14 12 0 1 10 6 9 11 5 0 14 7 11 10 4 13 1 5 8 12 6 9 3 2 15 13 8 10 1 3 15 4 2 11 6 7 12 0 5 14 9",
  "10 0 9 14 6 3 15 5 1 13 12 7 11 4 2 8 13 7 0 9 3 4 6 10 2 8 5 14 12 11 15 1 13 6 4 9 8 15 3 0 11 1 2 12 5 10 14 7 1 10 13 0 6 9 8 7 4 15 14 3 11 5 2 12",
  "7 13 14 3 0 6 9 10 1 2 8 5 11 12 4 15 13 8 11 5 6 15 0 3 4 7 2 12 1 10 14 9 10 6 9 0 12 11 7 13 15 1 3 14 5 2 8 4 3 15 0 6 10 1 13 8 9 4 5 11 12 7 2 14",
  "2 12 4 1 7 10 11 6 8 5 3 15 13 0 14 9 14 11 2 12 4 7 13 1 5 0 15 10 3 9 8 6 4 2 1 11 10 13 7 8 15 9 12 5 6 3 0 14 11 8 12 7 1 14 2 13 6 15 0 9 10 4 5 3",
  "12 1 10 15 9 2 6 8 0 13 3 4 14 7 5 11 10 15 4 2 7 12 9 5 6 1 13 14 0 11 3 8 9 14 15 5 2 8 12 3 7 0 4 10 1 13 11 6 4 3 2 12 9 5 15 10 11 14 1 7 6 0 8 13",
  "4 11 2 14 15 0 8 13 3 12 9 7 5 10 6 1 13 0 11 7 4 9 1 10 14 3 5 12 2 15 8 6 1 4 11 13 12 3 7 14 10 15 6 8 0 5 9 2 6 11 13 8 1 4 10 7 9 5 0 15 14 2 3 12",
  "13 2 8 4 6 15 11 1 10 9 3 14 5 0 12 7 1 15 13 8 10 3 7 4 12 5 6 11 0 14 9 2 7 11 4 1 9 12 14 2 0 6 10 13 15 3 5 8 2 1 14 7 4 10 8 13 15 12 9 0 3 5 6 11",
].map((s) => s.split(" ").map(Number));

const bitsOf = (bytes) => { const o = []; for (const x of bytes) for (let i = 7; i >= 0; i--) o.push((x >> i) & 1); return o; };
const perm = (src, table) => table.map((p) => src[p - 1]);
function desSubkeys(key8) {
  const k = perm(bitsOf(key8), PC1);
  let C = k.slice(0, 28), D = k.slice(28);
  return SHIFTS.map((s) => { C = [...C.slice(s), ...C.slice(0, s)]; D = [...D.slice(s), ...D.slice(0, s)]; return perm([...C, ...D], PC2); });
}
function desBits(bits, subkeys) {
  const b = perm(bits, IP);
  let L = b.slice(0, 32), R = b.slice(32);
  for (const k of subkeys) {
    const e = perm(R, E);
    const out = [];
    for (let s = 0; s < 8; s++) {
      const c = e.slice(6 * s, 6 * s + 6).map((x, i) => x ^ k[6 * s + i]);
      const v = SBOX[s][(c[0] * 2 + c[5]) * 16 + c[1] * 8 + c[2] * 4 + c[3] * 2 + c[4]];
      out.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
    }
    const f = perm(out, P);
    [L, R] = [R, L.map((x, i) => x ^ f[i])];
  }
  return perm([...R, ...L], FP);
}
// des-ede3 decryption of one block: D(k1, E(k2, D(k3, c))).
export function des3Decryptor(key24) {
  const k = [0, 8, 16].map((i) => desSubkeys(key24.subarray(i, i + 8)));
  const dec = [k[2].slice().reverse(), k[1], k[0].slice().reverse()];
  return (block) => {
    let bits = bitsOf(block);
    for (const sk of dec) bits = desBits(bits, sk);
    const out = new Uint8Array(8);
    for (let i = 0; i < 64; i++) out[i >> 3] |= bits[i] << (7 - (i & 7));
    return out;
  };
}

// ---- RC2 (RFC 2268), decryption only ----
const PITABLE = Uint8Array.from(("d978f9c419ddb5ed28e9fd794aa0d89dc67e37832b76538e624c6488448bfba2179a59f587b34f1361456d8d09817d32"
  + "bd8f40eb86b77b0bf09521225c6b4e8254d66593ce60b21c7356c014a78cf1dc1275ca1f3bbee4d1423dd430a33cb626"
  + "6fbf0eda4669075727f21d9bbc944303f811c7f690ef3ee706c3d52fc8661ed708e8eade8052eef784aa72ac354d6a2a"
  + "961ad2715a1549744b9fd05e0418a4ecc2e0416e0f51cbcc2491af50a1f47039997c3a8523b8b47afc02365b25559731"
  + "2d5dfa98e38a92ae05df2910676cbac9d300e6cfe19ea82c6316013f58e289a90d38341bab33ffb0bb480c5fb9b1cd2e"
  + "c5f3db47e5a59c770aa62068fe7fc1ad").match(/../g).map((h) => parseInt(h, 16)));
export function rc2Decryptor(key, effectiveBits) {
  const L = new Uint8Array(128);
  L.set(key);
  const T = key.length;
  for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 255];
  const T8 = (effectiveBits + 7) >> 3;
  const TM = 255 % (1 << (8 + effectiveBits - 8 * T8));
  L[128 - T8] = PITABLE[L[128 - T8] & TM];
  for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
  const K = new Uint16Array(64);
  for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
  const S = [1, 2, 3, 5];
  return (block) => {
    const R = [0, 2, 4, 6].map((i) => block[i] | (block[i + 1] << 8));
    let j = 63;
    const rmix = () => {
      for (let i = 3; i >= 0; i--) {
        R[i] = ((R[i] >>> S[i]) | (R[i] << (16 - S[i]))) & 0xffff;
        R[i] = (R[i] - K[j] - (R[(i + 3) & 3] & R[(i + 2) & 3]) - (~R[(i + 3) & 3] & R[(i + 1) & 3])) & 0xffff;
        j--;
      }
    };
    const rmash = () => { for (let i = 3; i >= 0; i--) R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xffff; };
    for (let n = 0; n < 5; n++) rmix();
    rmash();
    for (let n = 0; n < 6; n++) rmix();
    rmash();
    for (let n = 0; n < 5; n++) rmix();
    return Uint8Array.from(R.flatMap((w) => [w & 0xff, w >> 8]));
  };
}

// CBC with an 8-byte block cipher, then PKCS#7 padding off; null when the padding is wrong (a wrong key).
function cbcDecrypt(decrypt, iv, data) {
  if (!data.length || data.length % 8) return null;
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let at = 0; at < data.length; at += 8) {
    const c = data.subarray(at, at + 8);
    const p = decrypt(c);
    for (let i = 0; i < 8; i++) out[at + i] = p[i] ^ prev[i];
    prev = c;
  }
  const pad = out[out.length - 1];
  if (pad < 1 || pad > 8 || out.subarray(out.length - pad).some((x) => x !== pad)) return null;
  return out.subarray(0, out.length - pad);
}

// ---- password-based decryption of an AlgorithmIdentifier's content ----
async function pbeDecrypt(b, algId, data, password, subtle) {
  const [algOid, params] = children(b, algId);
  const alg = oidString(b, algOid);
  if (alg === OID.pbe3des || alg === OID.pbeRc2_40 || alg === OID.pbeRc2_128) {
    const [saltNode, iterNode] = children(b, params);
    const salt = value(b, saltNode), iterations = intOf(b, iterNode);
    if (iterations < 1 || iterations > 10_000_000) return null;
    const keyLen = alg === OID.pbe3des ? 24 : alg === OID.pbeRc2_40 ? 5 : 16;
    // An empty password is ambiguous (no bytes, or just the terminator): try both, as checkP12Password does.
    for (const pw of password ? [bmpPassword(password)] : [bmpPassword(""), new Uint8Array(0)]) {
      const key = await pkcs12Kdf(subtle, SHA1, pw, salt, iterations, 1, keyLen);
      const iv = await pkcs12Kdf(subtle, SHA1, pw, salt, iterations, 2, 8);
      const dec = alg === OID.pbe3des ? des3Decryptor(key) : rc2Decryptor(key, keyLen * 8);
      const out = cbcDecrypt(dec, iv, data);
      if (out) return out;
    }
    return null;
  }
  if (alg !== OID.pbes2) return null;
  const [kdf, scheme] = children(b, params);
  const [kdfOid, kdfParams] = children(b, kdf);
  if (oidString(b, kdfOid) !== OID.pbkdf2) return null;
  const kp = children(b, kdfParams);
  const salt = value(b, kp[0]), iterations = intOf(b, kp[1]);
  if (iterations < 1 || iterations > 10_000_000) return null;
  let hash = "SHA-1", keyLength = null;
  for (const n of kp.slice(2)) {
    if (n.tag === 0x02) keyLength = intOf(b, n);
    else if (n.tag === 0x30) hash = PRF[oidString(b, children(b, n)[0])];
  }
  if (!hash) return null;
  const [encOid, ivNode] = children(b, scheme);
  const enc = oidString(b, encOid);
  const iv = value(b, ivNode);
  const len = { [OID.aes128]: 16, [OID.aes192]: 24, [OID.aes256]: 32, [OID.desEde3]: 24 }[enc];
  if (!len) return null;
  const base = await subtle.importKey("raw", new TextEncoder().encode(password ?? ""), "PBKDF2", false, ["deriveBits"]);
  const key = new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash }, base, (keyLength ?? len) * 8));
  if (enc === OID.desEde3) return cbcDecrypt(des3Decryptor(key), iv, data);
  try {
    const k = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
    return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv }, k, data));
  } catch { return null; } // a wrong password: the padding check fails
}

// A bag's localKeyId attribute, or null.
function localKeyId(b, attrs) {
  if (!attrs || attrs.tag !== 0x31) return null;
  for (const a of children(b, attrs)) {
    const [id, vals] = children(b, a);
    if (oidString(b, id) === OID.localKeyId) { const v = children(b, vals)[0]; return v ? value(b, v) : null; }
  }
  return null;
}

// The bags of one SafeContents: certificates (with their localKeyId) and the key bags' localKeyIds.
function readBags(b, out) {
  for (const bag of children(b, der(b, 0))) {
    const [id, wrapped, attrs] = children(b, bag);
    const kind = oidString(b, id);
    const keyId = localKeyId(b, attrs);
    if (kind === OID.keyBag || kind === OID.shroudedKeyBag) { if (keyId) out.keyIds.push(keyId); continue; }
    if (kind !== OID.certBag) continue;
    const [certId, certWrap] = children(b, children(b, wrapped)[0]);
    if (oidString(b, certId) !== OID.x509) continue;
    const octets = children(b, certWrap)[0];
    if (octets?.tag === 0x04) out.certs.push({ cert: value(b, octets), keyId });
  }
}

// Every certificate in the .p12, or null when it can't be opened here.
export async function p12Certificates(buf, password = "", subtle = globalThis.crypto?.subtle) {
  const b = bytesOf(buf);
  const out = { certs: [], keyIds: [] };
  try {
    const [, authSafe] = children(b, der(b, 0));
    const [ctype, wrapped] = children(b, authSafe);
    if (oidString(b, ctype) !== OID.data) return null;
    const octets = children(b, wrapped)[0];
    if (octets.tag !== 0x04) return null; // BER (constructed OCTET STRING)
    const safe = value(b, octets);
    let locked = false;
    for (const ci of children(safe, der(safe, 0))) {
      const [t, content] = children(safe, ci);
      const type = oidString(safe, t);
      if (type === OID.data) {
        const o = children(safe, content)[0];
        if (o.tag === 0x04) readBags(value(safe, o), out);
      } else if (type === OID.encryptedData) {
        if (!subtle) { locked = true; continue; }
        const [, eci] = children(safe, children(safe, content)[0]);
        const [, algId, encrypted] = children(safe, eci);
        if (!encrypted || encrypted.tag !== 0x80) { locked = true; continue; } // constructed: BER
        const plain = await pbeDecrypt(safe, algId, value(safe, encrypted), password, subtle);
        if (plain) readBags(plain, out); else locked = true;
      }
    }
    if (!out.certs.length && locked) return null;
  } catch { return null; }
  return out.certs.map(({ cert, keyId }) => ({ cert, keyId, paired: out.keyIds.some((k) => same(k, keyId)) }));
}

// A certificate's issuer and subject (DER bytes).
function names(cert) {
  const tbs = children(cert, children(cert, der(cert, 0))[0]);
  const f = tbs[0].tag === 0xa0 ? tbs.slice(1) : tbs; // [0] version
  return { issuer: value(cert, f[2]), subject: value(cert, f[4]) };
}

// The certificate paired with the private key: the one whose localKeyId a key bag has, else the only one with a
// localKeyId, else the one that issued none of the others (a leaf, not its CA).
export function p12LeafCert(certs) {
  if (!certs?.length) return null;
  const paired = certs.filter((c) => c.paired);
  if (paired.length) return paired[0].cert;
  const keyed = certs.filter((c) => c.keyId);
  if (keyed.length === 1) return keyed[0].cert;
  if (certs.length === 1) return certs[0].cert;
  try {
    const n = certs.map((c) => names(c.cert));
    const leaf = certs.find((c, i) => !n.some((o, j) => j !== i && same(o.issuer, n[i].subject) && !same(o.subject, n[i].subject)));
    return (leaf ?? certs[0]).cert;
  } catch { return certs[0].cert; }
}

// The signing certificate's { serial, team (its OU) }, or null.
export async function p12Leaf(buf, password = "", subtle = globalThis.crypto?.subtle) {
  const leaf = p12LeafCert(await p12Certificates(buf, password, subtle));
  if (!leaf) return null;
  try {
    let team = null;
    try { team = parseCert(leaf).team; } catch { /* no team */ }
    return { serial: certSerial(leaf), team };
  } catch { return null; }
}

export async function p12Serial(buf, password = "", subtle = globalThis.crypto?.subtle) {
  return (await p12Leaf(buf, password, subtle))?.serial ?? null;
}
