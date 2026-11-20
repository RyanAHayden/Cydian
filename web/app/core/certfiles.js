// One pick for everything (Settings > Signing): the user selects their certificate files at once, or the .zip they
// came in, and this sorts them: the .p12, the .mobileprovision, and password candidates from any .txt. Then the
// first candidate that opens the .p12 is the password.
import { parseProfile, checkP12Password } from "./signing.js";
import { keyIdFromName } from "./asc.js";

const ext = (name) => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

// files: [{ name, bytes: Uint8Array }]. Returns { p12, profile, passwords: [string] } (p12/profile: { name, bytes }).
export async function sortCertFiles(files, { unzip = unzipEntries } = {}) {
  const out = { p12: null, profile: null, passwords: [] };
  const queue = [...files];
  while (queue.length) {
    const f = queue.shift();
    const e = ext(f.name);
    if (f.name.startsWith("__MACOSX/") || f.name.split("/").pop().startsWith("._")) continue;
    if (e === "zip") { queue.push(...await unzip(f.bytes)); continue; }
    if ((e === "p12" || e === "pfx") && !out.p12) { out.p12 = f; continue; }
    if (e === "mobileprovision" && !out.profile) {
      try { parseProfile(f.bytes); out.profile = f; } catch { /* not a profile */ }
      continue;
    }
    if (e === "txt" || e === "" || e === "md") out.passwords.push(...passwordCandidates(new TextDecoder().decode(f.bytes), f.name));
  }
  return out;
}

// Lines of a text file as password guesses: "password: x" / "pass = x" first, then every short line as it is.
export function passwordCandidates(text, name = "") {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.length <= 128);
  const labelled = lines.map((l) => l.match(/^(?:p12\s*)?(?:password|pass|pwd|密码)\s*[:=：-]\s*(.+)$/i)?.[1]?.trim()).filter(Boolean);
  const plain = lines.filter((l) => !/\s/.test(l) || lines.length === 1);
  const fromName = /pass(word)?/i.test(name) ? lines.slice(0, 1) : [];
  return [...new Set([...labelled, ...fromName, ...plain])];
}

// The first guess that opens the .p12 ("" counts: many certificates have none), or null.
export async function findPassword(p12, guesses, check = checkP12Password) {
  for (const g of [...guesses, ""]) if (await check(p12, g) === true) return g;
  return null;
}

// A .zip's files: [{ name, bytes }]. Stored and deflated entries (every zip a phone or a Mac makes); deflate goes
// through DecompressionStream("deflate-raw") (iOS 16.4+). ponytail: no zip64 or encryption; certificate zips are tiny.
export async function unzipEntries(zip) {
  const b = zip instanceof Uint8Array ? zip : new Uint8Array(zip);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || size > 4 * 1024 * 1024) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + size);
    if (method === 0) out.push({ name, bytes: raw.slice() });
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.push({ name, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) });
    }
  }
  return out;
}

// F248: after a pick, the .p12's password: the saved one if it still opens it, else the first guess (or "") that
// does. `locked`: none opens it and none saved might (the Password field is focused for typing). passwordOk is true
// when one opens it, false when the saved one doesn't, null when nothing is known yet.
export async function resolvePassword(p12, saved, guesses = [], check = checkP12Password) {
  const savedOk = saved != null ? await check(p12, saved) : null;
  if (savedOk === true) return { password: saved, passwordOk: true, locked: false };
  const pw = await findPassword(p12, guesses, check);
  if (pw != null) return { password: pw, passwordOk: true, locked: false };
  return { password: saved ?? null, passwordOk: saved != null ? savedOk : null, locked: saved == null || savedOk === false };
}

// F277: Add API Key's pick, sorted the same way: the AuthKey_<Key ID>.p8 (by name, or any file holding a PEM private
// key), and the Issuer ID from a .txt (or a note with no extension) beside it, or the .zip they came in. The Issuer
// ID isn't in the .p8 and Apple gives it to no call made without it, so it's typed, pasted or read from such a file.
// files: [{ name, bytes: Uint8Array }]. Returns { p8: { name, text } | null, keyId: string | null, issuerId: string | null }.
export const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
export async function sortKeyFiles(files, { unzip = unzipEntries } = {}) {
  const out = { p8: null, keyId: null, issuerId: null };
  const texts = [];
  const queue = [...files];
  while (queue.length) {
    const f = queue.shift();
    const e = ext(f.name);
    const base = f.name.split("/").pop();
    if (f.name.startsWith("__MACOSX/") || base.startsWith("._")) continue;
    if (e === "zip") { queue.push(...await unzip(f.bytes)); continue; }
    if (e !== "p8" && e !== "txt" && e !== "md" && e !== "") continue;
    const text = new TextDecoder().decode(f.bytes);
    if (/-----BEGIN PRIVATE KEY-----/.test(text)) { if (!out.p8) out.p8 = { name: base, text }; continue; }
    if (e !== "p8") texts.push(text);
  }
  const ids = texts.map(issuerFromText).filter(Boolean);
  out.issuerId = ids[0] ?? null;
  out.keyId = (out.p8 && keyIdFromName(out.p8.name)) || texts.map(labelledKeyId).find(Boolean) || null;
  return out;
}

// The Issuer ID in a text: a UUID, the one on an "Issuer"-labelled line first. Lowercase, as App Store Connect shows it.
export function issuerFromText(text) {
  const s = String(text ?? "");
  const lines = s.split(/\r?\n/);
  const labelled = lines.find((l) => /issuer/i.test(l) && UUID_RE.test(l));
  const m = (labelled ?? s).match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}
const labelledKeyId = (text) => String(text).match(/key\s*id\s*[:=：-]\s*([A-Z0-9]{10})\b/i)?.[1]?.toUpperCase() ?? null;
