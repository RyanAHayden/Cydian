// F75: moving what the user set up on the website into the sideload app. Pure JS (WebCrypto and CompressionStream
// are globals in Safari and in node), so node tests cover both ends. docs/signing.md, "From the website to the app".
//
// Import from Safari (the certificate, encrypted):
//   newKey()                          a random 256-bit AES key, base64url (43 characters)
//   exportUrl(server, key)            <server>/#/settings/signing-export.<key>: the key rides in the fragment, which
//                                     a browser never sends to a server
//   exportKey(segment)                the key back from that route segment, or null
//   await sealIdentity(id, key)       AES-GCM over the .p12, password and profile: base64url(iv ‖ ciphertext)
//   await openIdentity(text, key)     the identity back ({ p12, profile: Uint8Array, password, p12Name, profileName })
//   importUrl(sealed)                 cydian://signing-import#<sealed>: only ciphertext travels in a URL, so another
//                                     app that claims cydian:// gets nothing it can use
//
// Open in Cydian App (sources and settings, never the certificate):
//   await encodeLink({ sources, settings, holds, server })   cydian://import?d=<base64url of gzipped JSON>
//   await decodeLink(url, { gunzip })                        the payload, or null for anything else
//   reviewLink(payload, { have, get, shown, holds, server }) what's new: { sources, settings, holds, server, empty }
//
// The payload: { v: 1, sources: [line] (core/sourcelist.js exportLine: a URL, or `deb <uri> <dist> <components>`),
// settings: { key: value } (core/settings.js TRAVELS), holds: [package], server: "https://…" | null }.
import { parseImport, reviewImport } from "./sourcelist.js";
import { normalizeServer } from "./signing.js";

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("This browser has no WebCrypto.");
  return s;
};

export function toB64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  const s = String(text ?? "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error("not base64url");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const bytes = (v) => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : Array.isArray(v) ? Uint8Array.from(v) : null);

// ---- Import from Safari ----------------------------------------------------------------------------------------

export function newKey() {
  return toB64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
export const EXPORT_SEGMENT = "signing-export";
export const exportUrl = (server, key) => `${String(server).replace(/\/+$/, "")}/#/settings/${EXPORT_SEGMENT}.${key}`;

export function exportKey(segment) {
  const m = new RegExp(`^${EXPORT_SEGMENT}\\.(.+)$`).exec(String(segment ?? ""));
  return m && KEY_RE.test(m[1]) ? m[1] : null;
}

async function aesKey(key, use) {
  if (!KEY_RE.test(String(key))) throw new Error("bad key");
  return subtle().importKey("raw", fromB64url(key), { name: "AES-GCM" }, false, [use]);
}

export async function sealIdentity(id, key, { iv = globalThis.crypto.getRandomValues(new Uint8Array(12)) } = {}) {
  const p12 = bytes(id?.p12), profile = bytes(id?.profile);
  if (!p12?.length || !profile?.length) throw new Error("no certificate");
  const json = JSON.stringify({ v: 1, p12: toB64url(p12), profile: toB64url(profile), password: id.password ?? "",
    p12Name: id.p12Name ?? "", profileName: id.profileName ?? "" });
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await aesKey(key, "encrypt"), new TextEncoder().encode(json)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64url(out);
}

// Throws on a wrong key, a changed byte (GCM's tag) or anything that isn't one of ours.
export async function openIdentity(text, key) {
  const all = fromB64url(text);
  if (all.length < 12 + 16) throw new Error("too short");
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: all.subarray(0, 12) }, await aesKey(key, "decrypt"), all.subarray(12));
  const j = JSON.parse(new TextDecoder().decode(plain));
  if (j?.v !== 1 || typeof j.p12 !== "string" || typeof j.profile !== "string") throw new Error("not a certificate");
  return { p12: fromB64url(j.p12), profile: fromB64url(j.profile), password: String(j.password ?? ""),
    p12Name: String(j.p12Name || "Certificate.p12"), profileName: String(j.profileName || "Profile.mobileprovision") };
}

export const importUrl = (sealed) => `cydian://signing-import#${sealed}`;

// The ciphertext from a cydian://signing-import#… link, or null.
export function sealedFrom(url) {
  const m = /^cydian:\/\/signing-import\/?#([A-Za-z0-9_-]+)$/i.exec(String(url ?? ""));
  return m ? m[1] : null;
}

// ---- Open in Cydian App ----------------------------------------------------------------------------------------

async function pipe(data, stream) {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeLink({ sources = [], settings = {}, holds = [], server = null } = {}) {
  const payload = { v: 1, sources: [...new Set(sources.filter((s) => typeof s === "string" && s))], settings,
    holds: [...new Set(holds.filter((p) => typeof p === "string" && p))], server: normalizeServer(server) ?? null };
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream("gzip"));
  return "cydian://import?d=" + toB64url(gz);
}

// `gunzip(bytes)` -> text, for a web view without DecompressionStream (the shell's app.gunzip).
export async function decodeLink(url, { gunzip = null } = {}) {
  const m = /^cydian:\/\/import\/?\?(?:.*&)?d=([A-Za-z0-9_-]+)(?:&|$)/i.exec(String(url ?? ""));
  if (!m) return null;
  try {
    const gz = fromB64url(m[1]);
    let text;
    if (typeof DecompressionStream === "function") text = new TextDecoder().decode(await pipe(gz, new DecompressionStream("gzip")));
    else if (gunzip) text = await gunzip(gz);
    else return null;
    const p = JSON.parse(text);
    if (p?.v !== 1) return null;
    return {
      v: 1,
      sources: Array.isArray(p.sources) ? p.sources.filter((s) => typeof s === "string") : [],
      settings: p.settings && typeof p.settings === "object" && !Array.isArray(p.settings) ? p.settings : {},
      holds: Array.isArray(p.holds) ? p.holds.filter((s) => typeof s === "string") : [],
      server: normalizeServer(p.server) ?? null,
    };
  } catch {
    return null;
  }
}

// What importing would change, nothing else. `have`: the app's sources ({ key }); `get(key)`: a setting's value
// here; `shown(key)`: whether this build has that setting (the site's Device and iOS Version mean nothing in the
// app); `holds`: the packages already ignored; `server`: the Signing Server here. Sources already listed, settings
// already the same, holds already there and the same server are left out, so the user's own stay as they are.
export function reviewLink(payload, { have = [], get = () => undefined, shown = () => true, holds = [], server = null } = {}) {
  const { entries } = parseImport((payload?.sources ?? []).join("\n"));
  const sources = reviewImport(entries, have).filter((e) => e.status === "new");
  const settings = Object.entries(payload?.settings ?? {})
    .filter(([k, v]) => shown(k) && get(k) !== undefined && get(k) !== v)
    .map(([key, value]) => ({ key, from: get(key), to: value }));
  const mine = new Set(holds);
  const newHolds = [...new Set(payload?.holds ?? [])].filter((p) => !mine.has(p));
  const there = normalizeServer(payload?.server);
  const srv = there && there !== normalizeServer(server) ? { from: server, to: there } : null;
  return { sources, settings, holds: newHolds, server: srv, empty: !sources.length && !settings.length && !newHolds.length && !srv };
}
