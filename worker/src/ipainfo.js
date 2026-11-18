// F160: what an IPA says about itself, read with HTTP Range requests, never the whole file: the zip's end record (or
// zip64's), its central directory, then only Payload/<name>.app/Info.plist (100-350 KB of a 50 MB app). The proof was
// tools/ipa-plist-probe.py. SPDX-License-Identifier: GPL-3.0-or-later
//
//   readIpaInfo(range)  -> { minOSVersion, deviceFamily, bundleId, version }; throws IpaError(code) when it can't:
//                          code "no_range" (the server sends the whole file), "not_zip", "no_plist", "too_large",
//                          "bad_plist", "upstream" (HTTP errors, timeouts: worth asking again later)
//     range(start, end) -> Promise<{ bytes: Uint8Array, total }> for bytes start..end (inclusive). No suffix ranges
//                          ("bytes=-N"): GitHub's release asset store answers those 501, so the first read (the
//                          local header's "PK\3\4") tells the size
//   plistInfo(bytes)    -> the same four fields from an Info.plist, binary (bplist00) or XML
//   inflateRaw(bytes)   -> Promise<Uint8Array> (DecompressionStream "deflate-raw": Workers and Node 22)

export class IpaError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

const MAX_CD = 16 * 1024 * 1024;   // a central directory bigger than this is an odd zip, not an app
const MAX_PLIST = 4 * 1024 * 1024; // Info.plist is a few KB; a big one is something else
const TAIL = 65536 + 22 + 20 + 56; // the end record's comment can be 64 KB, then zip64's locator and record

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
const sig = (b, o, s) => b[o] === 0x50 && b[o + 1] === 0x4b && b[o + 2] === s[0] && b[o + 3] === s[1];

export async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readIpaInfo(range) {
  const { bytes: head, total } = await range(0, 3);
  if (head.length < 4 || !sig(head, 0, [3, 4])) throw new IpaError("not_zip", "That file isn't a zip archive.");
  const tailStart = Math.max(0, total - TAIL);
  const { bytes: tail } = await range(tailStart, total - 1);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (sig(tail, i, [5, 6])) { e = i; break; }
  if (e < 0) throw new IpaError("not_zip", "That file isn't a zip archive.");
  let entries = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || entries === 0xffff) {
    // zip64: the locator sits just before the end record and points at zip64's own end record
    const l = e - 20;
    if (l < 0 || !sig(tail, l, [6, 7])) throw new IpaError("not_zip", "A zip64 archive without its locator.");
    const at = u64(tail, l + 8);
    const rec = at >= tailStart ? tail.subarray(at - tailStart) : (await range(at, at + 55)).bytes;
    if (!sig(rec, 0, [6, 6])) throw new IpaError("not_zip", "A zip64 archive without its end record.");
    entries = u64(rec, 32); cdSize = u64(rec, 40); cdOff = u64(rec, 48);
  }
  if (cdSize > MAX_CD) throw new IpaError("too_large", "The zip's directory is too big.");
  if (cdOff + cdSize > total) throw new IpaError("not_zip", "The zip's directory is past the end of the file.");
  const cd = cdOff >= tailStart ? tail.subarray(cdOff - tailStart, cdOff - tailStart + cdSize) : (await range(cdOff, cdOff + cdSize - 1)).bytes;
  const names = new TextDecoder();
  let p = 0;
  for (let n = 0; n < entries && p + 46 <= cd.length && sig(cd, p, [1, 2]); n++) {
    const method = u16(cd, p + 10);
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24), off = u32(cd, p + 42);
    const nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
    const name = names.decode(cd.subarray(p + 46, p + 46 + nl));
    if (/^Payload\/[^/]+\.app\/Info\.plist$/.test(name)) {
      // zip64 sizes and offset live in the 0x0001 extra field, only those whose 32-bit field is all ones, in order
      for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl;) {
        const id = u16(cd, x), len = u16(cd, x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; }
          if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
          if (off === 0xffffffff) off = u64(cd, q);
        }
        x += 4 + len;
      }
      if (csize > MAX_PLIST || usize > MAX_PLIST) throw new IpaError("too_large", "Info.plist is too big.");
      if (method !== 0 && method !== 8) throw new IpaError("not_zip", `Info.plist is packed with method ${method}.`);
      // The local header's extra field can differ from the directory's: ask for some slack, and again if short.
      const slack = 30 + nl + xl + 512;
      let got = (await range(off, Math.min(total - 1, off + slack + csize - 1))).bytes;
      if (!sig(got, 0, [3, 4])) throw new IpaError("not_zip", "Info.plist's local header is missing.");
      const start = 30 + u16(got, 26) + u16(got, 28);
      if (got.length < start + csize) got = (await range(off, off + start + csize - 1)).bytes;
      const raw = got.subarray(start, start + csize);
      let plist;
      try { plist = method === 8 ? await inflateRaw(raw) : raw; } catch { throw new IpaError("bad_plist", "Info.plist didn't inflate."); }
      return plistInfo(plist);
    }
    p += 46 + nl + xl + cl;
  }
  throw new IpaError("no_plist", "The IPA has no Payload/*.app/Info.plist.");
}

// ---- Info.plist -------------------------------------------------------------------------------------------------

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
function families(v) {
  const list = (Array.isArray(v) ? v : v == null ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? [...new Set(list)] : null;
}
function pick(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new IpaError("bad_plist", "Info.plist isn't a dictionary.");
  return { minOSVersion: text(d.MinimumOSVersion), deviceFamily: families(d.UIDeviceFamily), bundleId: text(d.CFBundleIdentifier),
    version: text(d.CFBundleShortVersionString) ?? text(d.CFBundleVersion) };
}

export function plistInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (new TextDecoder().decode(b.subarray(0, 8)) === "bplist00") return pick(binaryPlist(b));
  return pick(xmlPlist(new TextDecoder().decode(b)));
}

// The binary plist's top object, as plain JS (dictionaries, arrays, strings, numbers, booleans; data and dates as null).
function binaryPlist(b) {
  if (b.length < 40) throw new IpaError("bad_plist", "A binary plist too short for its trailer.");
  const t = b.length - 32;
  const offSize = b[t + 6], refSize = b[t + 7];
  const count = u64be(b, t + 8, 8), top = u64be(b, t + 16, 8), table = u64be(b, t + 24, 8);
  if (!offSize || !refSize || table + count * offSize > t) throw new IpaError("bad_plist", "A broken binary plist trailer.");
  const offsetOf = (i) => { if (i >= count) throw new IpaError("bad_plist", "A binary plist reference out of range."); return u64be(b, table + i * offSize, offSize); };
  const utf16 = new TextDecoder("utf-16be"), ascii = new TextDecoder("latin1"), utf8 = new TextDecoder();
  function lenAt(o) {
    const n = b[o] & 0x0f;
    if (n !== 0x0f) return [n, o + 1];
    const m = b[o + 1];
    if ((m & 0xf0) !== 0x10) throw new IpaError("bad_plist", "A binary plist length that isn't an integer.");
    const w = 1 << (m & 0x0f);
    return [u64be(b, o + 2, w), o + 2 + w];
  }
  function obj(i, depth) {
    if (depth > 32) throw new IpaError("bad_plist", "A binary plist nested too deep.");
    const o = offsetOf(i);
    if (o >= t) throw new IpaError("bad_plist", "A binary plist object out of range.");
    const kind = b[o] >> 4;
    switch (kind) {
      case 0x0: return b[o] === 0x09 ? true : b[o] === 0x08 ? false : null;
      case 0x1: { const w = 1 << (b[o] & 0x0f); return w > 8 ? null : u64be(b, o + 1, w); }
      case 0x2: { const w = 1 << (b[o] & 0x0f); const v = new DataView(b.buffer, b.byteOffset + o + 1, w); return w === 4 ? v.getFloat32(0) : w === 8 ? v.getFloat64(0) : null; }
      case 0x5: { const [n, s] = lenAt(o); return ascii.decode(b.subarray(s, s + n)); }
      case 0x6: { const [n, s] = lenAt(o); return utf16.decode(b.subarray(s, s + 2 * n)); }
      case 0x7: { const [n, s] = lenAt(o); return utf8.decode(b.subarray(s, s + n)); }
      case 0xa: { const [n, s] = lenAt(o); return Array.from({ length: n }, (_, k) => obj(u64be(b, s + k * refSize, refSize), depth + 1)); }
      case 0xd: {
        const [n, s] = lenAt(o);
        const d = {};
        for (let k = 0; k < n; k++) {
          const key = obj(u64be(b, s + k * refSize, refSize), depth + 1);
          if (typeof key === "string") d[key] = obj(u64be(b, s + (n + k) * refSize, refSize), depth + 1);
        }
        return d;
      }
      default: return null; // data, dates, UIDs, sets: nothing this reads
    }
  }
  return obj(top, 0);
}
function u64be(b, o, w) {
  if (o + w > b.length) throw new IpaError("bad_plist", "A binary plist read past its end.");
  let v = 0;
  for (let k = 0; k < w; k++) v = v * 256 + b[o + k];
  return v;
}

// An XML plist's top-level dictionary: only the keys this reads, as strings, integers or arrays of them.
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function xmlPlist(s) {
  if (!/<plist[\s>]/.test(s) || !/<dict>/.test(s)) throw new IpaError("bad_plist", "Info.plist isn't a plist.");
  const d = {};
  for (const key of ["MinimumOSVersion", "UIDeviceFamily", "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"]) {
    const m = new RegExp(`<key>\\s*${key}\\s*</key>\\s*(<array>([\\s\\S]*?)</array>|<array\\s*/>|<(string|integer)>([\\s\\S]*?)</\\3>)`).exec(s);
    if (!m) continue;
    if (m[1].startsWith("<array")) d[key] = [...(m[2] ?? "").matchAll(/<(?:string|integer)>([\s\S]*?)<\/(?:string|integer)>/g)].map((x) => unxml(x[1].trim()));
    else d[key] = unxml(m[4].trim());
  }
  return d;
}
