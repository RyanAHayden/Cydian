// F75: Send Settings (Open in iFizBox App) on the website: its sources, settings and Ignored Upgrades into the
// sideload app, as one ifizbox://import link. Pure JS (CompressionStream is a global in Safari and in node), so node
// tests cover both ends. F93: the website keeps a certificate again (Settings > Signing, signing in the browser), so
// it travels too, as before F89; the Signing Server doesn't (the app keeps its own).
//
//   await encodeLink({ sources, settings, holds, identity })   ifizbox://import?d=<base64url of gzipped JSON>
//   await decodeLink(url, { gunzip })                  the payload, or null for anything else
//   reviewLink(payload, { have, get, shown, holds })   what's new: { sources, settings, holds, empty }
//
// The payload: { v: 1, sources: [line] (core/sourcelist.js exportLine: a URL, or `deb <uri> <dist> <components>`),
// settings: { key: value } (core/settings.js TRAVELS), holds: [package], identity?: { p12, profile (base64url),
// password, p12Name, profileName } }. A link's server is left out.
import { parseImport, reviewImport } from "./sourcelist.js";

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

// F93: a certificate in a link: both files as base64url text, or null.
function identityOf(id) {
  if (!id || typeof id !== "object" || typeof id.p12 !== "string" || typeof id.profile !== "string" || !id.p12 || !id.profile) return null;
  const str = (v) => (typeof v === "string" ? v : "");
  return { p12: id.p12, profile: id.profile, password: str(id.password), p12Name: str(id.p12Name), profileName: str(id.profileName) };
}

// ---- Open in iFizBox App ----------------------------------------------------------------------------------------

async function pipe(data, stream) {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeLink({ sources = [], settings = {}, holds = [], identity = null } = {}) {
  const payload = { v: 1, sources: [...new Set(sources.filter((s) => typeof s === "string" && s))], settings,
    holds: [...new Set(holds.filter((p) => typeof p === "string" && p))], ...(identityOf(identity) ? { identity: identityOf(identity) } : {}) };
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream("gzip"));
  return "ifizbox://import?d=" + toB64url(gz);
}

// `gunzip(bytes)` -> text, for a web view without DecompressionStream (the shell's app.gunzip).
export async function decodeLink(url, { gunzip = null } = {}) {
  const m = /^ifizbox:\/\/import\/?\?(?:.*&)?d=([A-Za-z0-9_-]+)(?:&|$)/i.exec(String(url ?? ""));
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
      ...(identityOf(p.identity) ? { identity: identityOf(p.identity) } : {}),
    };
  } catch {
    return null;
  }
}

// What importing would change, nothing else. `have`: the app's sources ({ key }); `get(key)`: a setting's value
// here; `shown(key)`: whether this build has that setting (the site's Device and iOS Version mean nothing in the
// app); `holds`: the packages already ignored. Sources already listed, settings already the same and holds already
// there are left out, so the user's own stay as they are.
export function reviewLink(payload, { have = [], get = () => undefined, shown = () => true, holds = [] } = {}) {
  const { entries } = parseImport((payload?.sources ?? []).join("\n"));
  const sources = reviewImport(entries, have).filter((e) => e.status === "new");
  const settings = Object.entries(payload?.settings ?? {})
    .filter(([k, v]) => shown(k) && get(k) !== undefined && get(k) !== v)
    .map(([key, value]) => ({ key, from: get(key), to: value }));
  const mine = new Set(holds);
  const newHolds = [...new Set(payload?.holds ?? [])].filter((p) => !mine.has(p));
  return { sources, settings, holds: newHolds, empty: !sources.length && !settings.length && !newHolds.length };
}
