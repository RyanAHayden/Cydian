// Archive readers for tweak injection (core/tweaks.js), in plain JS so they run the same on the website, in the app's
// web view (an iOS 15 WebKit has no DecompressionStream) and under node --test: DEFLATE (raw, gzip, zip), LZMA
// (.lzma "alone" files) and xz (LZMA2 blocks), ar (a .deb's outer file), tar and zip. Everything works on
// Uint8Arrays in memory; a tweak is a few megabytes at most.
//
//   inflate(bytes) -> bytes          raw DEFLATE (RFC 1951)
//   gunzip(bytes) -> bytes           gzip members (RFC 1952), concatenated
//   unlzma(bytes) -> bytes           an LZMA "alone" file (13-byte header), with or without its end marker
//   unxz(bytes) -> bytes             an xz stream of LZMA2 blocks (no BCJ or delta filters: debs don't use them)
//   decompress(name, bytes) -> bytes by the file's extension (.gz .xz .lzma or none); throws for .zst and .bz2
//   readAr(bytes) -> [{ name, data }]                  a Unix ar archive (a .deb's outer layer)
//   readTar(bytes) -> [{ path, type, data, link }]     ustar/GNU/pax; type "file" | "dir" | "symlink" | "link"
//   readZip(bytes) -> [{ path, data, dir }]            stored and deflated entries (no ZIP64, no encryption)
//
// Errors are UnpackError with a sentence a person can read. The LZMA decoder follows the LZMA SDK's reference
// decoder (LzmaSpec.cpp, public domain) and xz's file format spec (public domain); inflate follows RFC 1951.
// SPDX-License-Identifier: GPL-3.0-or-later

export class UnpackError extends Error {
  constructor(message) { super(message); this.name = "UnpackError"; this.code = "bad_tweak"; }
}
const fail = (m) => { throw new UnpackError(m); };

// A Uint8Array that grows as bytes are written.
class Out {
  constructor(size = 1 << 16) { this.buf = new Uint8Array(Math.max(16, size)); this.n = 0; }
  room(k) {
    if (this.n + k <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.n + k) s *= 2;
    const b = new Uint8Array(s);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  byte(v) { this.room(1); this.buf[this.n++] = v; }
  bytes(src) { this.room(src.length); this.buf.set(src, this.n); this.n += src.length; }
  result() { return this.buf.slice(0, this.n); }
}

// ---- DEFLATE ---------------------------------------------------------------------------------------------------

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// A canonical Huffman code from code lengths: counts per length and symbols in code order.
function huffman(lengths) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(lengths.length);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s;
  return { count, symbols };
}

let FIXED = null;
function fixedCodes() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  FIXED = { lit: huffman(l), dist: huffman(new Uint8Array(30).fill(5)) };
  return FIXED;
}

// Raw DEFLATE from `src` at `start`; returns { data, end } (end: the byte after the last block). `limit` caps the
// output (a decompression bomb stops there).
export function inflateAt(src, start = 0, limit = 1 << 30) {
  let pos = start, bit = 0, bits = 0;
  const need = (n) => {
    while (bits < n) {
      if (pos >= src.length) fail("The compressed data ends too soon.");
      bit |= src[pos++] << bits; bits += 8;
    }
  };
  const take = (n) => { need(n); const v = bit & ((1 << n) - 1); bit >>>= n; bits -= n; return v; };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= take(1);
      const c = h.count[len];
      if (code - c < first) return h.symbols[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    return fail("The compressed data is damaged (a bad Huffman code).");
  };
  const out = new Out(Math.min(limit, Math.max(1 << 16, (src.length - start) * 4)));
  let last = 0;
  while (!last) {
    last = take(1);
    const type = take(2);
    if (type === 0) {
      bit = 0; bits = 0; // to a byte boundary
      if (pos + 4 > src.length) fail("The compressed data ends too soon.");
      const len = src[pos] | (src[pos + 1] << 8);
      if ((len ^ 0xffff) !== (src[pos + 2] | (src[pos + 3] << 8))) fail("The compressed data is damaged (a stored block's length).");
      pos += 4;
      if (pos + len > src.length) fail("The compressed data ends too soon.");
      if (out.n + len > limit) fail("The file unpacks too big.");
      out.bytes(src.subarray(pos, pos + len));
      pos += len;
      continue;
    }
    let lit, dist;
    if (type === 1) ({ lit, dist } = fixedCodes());
    else if (type === 2) {
      const hlit = take(5) + 257, hdist = take(5) + 1, hclen = take(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = take(3);
      const clh = huffman(cl);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const s = decode(clh);
        if (s < 16) { lens[i++] = s; continue; }
        let rep, val = 0;
        if (s === 16) { if (!i) fail("The compressed data is damaged."); val = lens[i - 1]; rep = 3 + take(2); }
        else if (s === 17) rep = 3 + take(3);
        else rep = 11 + take(7);
        if (i + rep > lens.length) fail("The compressed data is damaged.");
        lens.fill(val, i, i + rep); i += rep;
      }
      lit = huffman(lens.subarray(0, hlit));
      dist = huffman(lens.subarray(hlit));
    } else fail("The compressed data is damaged (block type 3).");
    for (;;) {
      const s = decode(lit);
      if (s < 256) { if (out.n >= limit) fail("The file unpacks too big."); out.byte(s); continue; }
      if (s === 256) break;
      const li = s - 257;
      if (li >= 29) fail("The compressed data is damaged.");
      const len = LEN_BASE[li] + take(LEN_EXTRA[li]);
      const ds = decode(dist);
      if (ds >= 30) fail("The compressed data is damaged.");
      const d = DIST_BASE[ds] + take(DIST_EXTRA[ds]);
      if (d > out.n) fail("The compressed data is damaged (a distance too far back).");
      if (out.n + len > limit) fail("The file unpacks too big.");
      out.room(len);
      const b = out.buf;
      for (let k = 0; k < len; k++) { b[out.n] = b[out.n - d]; out.n++; }
    }
  }
  return { data: out.result(), end: pos };
}

export const inflate = (src, limit) => inflateAt(src, 0, limit).data;

export function gunzip(src, limit = 1 << 30) {
  const parts = [];
  let pos = 0, total = 0;
  while (pos < src.length) {
    if (src[pos] !== 0x1f || src[pos + 1] !== 0x8b) { if (parts.length) break; fail("That isn't gzip data."); }
    if (src[pos + 2] !== 8) fail("The gzip data uses an unknown method.");
    const flg = src[pos + 3];
    let p = pos + 10;
    if (flg & 4) p += 2 + (src[p] | (src[p + 1] << 8));
    if (flg & 8) { while (p < src.length && src[p]) p++; p++; }
    if (flg & 16) { while (p < src.length && src[p]) p++; p++; }
    if (flg & 2) p += 2;
    const { data, end } = inflateAt(src, p, limit - total);
    parts.push(data);
    total += data.length;
    pos = end + 8; // CRC-32 and size
  }
  return concat(parts);
}

function concat(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- LZMA ------------------------------------------------------------------------------------------------------

class Range {
  constructor(src, pos) {
    this.src = src; this.pos = pos; this.range = 0xffffffff; this.code = 0;
    if (src[pos] !== 0) fail("The LZMA data is damaged.");
    this.pos++;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0;
    if (this.code === this.range) fail("The LZMA data is damaged.");
  }
  next() { if (this.pos >= this.src.length) fail("The compressed data ends too soon."); return this.src[this.pos++]; }
  norm() {
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.next()) >>> 0;
    }
  }
  bit(p, i) {
    const v = p[i], bound = (this.range >>> 11) * v;
    let b;
    if (this.code < bound) { this.range = bound; p[i] = v + ((2048 - v) >>> 5); b = 0; }
    else { this.range -= bound; this.code -= bound; p[i] = v - (v >>> 5); b = 1; }
    this.norm();
    return b;
  }
  direct(n) {
    let r = 0;
    while (n--) {
      this.range >>>= 1;
      let b = 0;
      if (this.code >= this.range) { this.code -= this.range; b = 1; }
      r = r * 2 + b;
      this.norm();
    }
    return r;
  }
  tree(p, base, n) {
    let m = 1;
    for (let i = 0; i < n; i++) m = (m << 1) + this.bit(p, base + m);
    return m - (1 << n);
  }
  reverse(p, base, n) {
    let m = 1, s = 0;
    for (let i = 0; i < n; i++) { const b = this.bit(p, base + m); m = (m << 1) + b; s |= b << i; }
    return s;
  }
}

// Probability arrays and state of one LZMA decoder; LZMA2 keeps it across chunks.
class Lzma {
  constructor(out) { this.out = out; this.dictStart = 0; this.setProps(3, 0, 2); }
  setProps(lc, lp, pb) {
    if (lc > 8 || lp > 4 || pb > 4) fail("The LZMA data has bad properties.");
    this.lc = lc; this.lp = lp; this.pb = pb;
    this.literal = new Uint16Array(0x300 << (lc + lp));
    this.reset();
  }
  reset() {
    this.literal.fill(1024);
    const p = (n) => new Uint16Array(n).fill(1024);
    this.isMatch = p(192); this.isRep = p(12); this.isRepG0 = p(12); this.isRepG1 = p(12); this.isRepG2 = p(12);
    this.isRep0Long = p(192); this.posSlot = p(256); this.posDec = p(115); this.align = p(16);
    this.len = { choice: p(2), low: p(256), mid: p(256), high: p(256) };
    this.repLen = { choice: p(2), low: p(256), mid: p(256), high: p(256) };
    this.state = 0; this.reps = [0, 0, 0, 0];
  }
  length(rc, l, posState) {
    if (!rc.bit(l.choice, 0)) return rc.tree(l.low, posState << 3, 3);
    if (!rc.bit(l.choice, 1)) return 8 + rc.tree(l.mid, posState << 3, 3);
    return 16 + rc.tree(l.high, 0, 8);
  }
  distance(rc, len) {
    const slot = rc.tree(this.posSlot, Math.min(len, 3) << 6, 6);
    if (slot < 4) return slot;
    const nd = (slot >>> 1) - 1;
    let d = (2 | (slot & 1)) * 2 ** nd;
    if (slot < 14) d += rc.reverse(this.posDec, d - slot, nd);
    else d += rc.direct(nd - 4) * 16 + rc.reverse(this.align, 0, 4);
    return d;
  }
  // Decodes until the output holds `until` bytes (or the end marker, when `marker` allows one).
  // Returns true when it stopped on the end marker.
  run(rc, until, marker) {
    const out = this.out;
    const pbMask = (1 << this.pb) - 1, lpMask = (1 << this.lp) - 1;
    let { state } = this;
    const reps = this.reps;
    while (out.n < until || (until === Infinity)) {
      const pos = out.n, posState = pos & pbMask;
      if (!rc.bit(this.isMatch, (state << 4) + posState)) {
        const prev = pos > this.dictStart ? out.buf[pos - 1] : 0;
        const base = 0x300 * (((pos & lpMask) << this.lc) + (prev >>> (8 - this.lc)));
        let s = 1;
        if (state >= 7) {
          if (reps[0] >= pos - this.dictStart) fail("The LZMA data is damaged.");
          let mb = out.buf[pos - reps[0] - 1];
          do {
            const m = (mb >>> 7) & 1;
            mb <<= 1;
            const b = rc.bit(this.literal, base + ((1 + m) << 8) + s);
            s = (s << 1) | b;
            if (m !== b) break;
          } while (s < 0x100);
        }
        while (s < 0x100) s = (s << 1) | rc.bit(this.literal, base + s);
        out.byte(s - 0x100);
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let len;
      if (rc.bit(this.isRep, state)) {
        if (pos === this.dictStart) fail("The LZMA data is damaged.");
        if (!rc.bit(this.isRepG0, state)) {
          if (!rc.bit(this.isRep0Long, (state << 4) + posState)) {
            state = state < 7 ? 9 : 11;
            out.byte(out.buf[pos - reps[0] - 1]);
            continue;
          }
        } else {
          let d;
          if (!rc.bit(this.isRepG1, state)) d = reps[1];
          else {
            if (!rc.bit(this.isRepG2, state)) d = reps[2];
            else { d = reps[3]; reps[3] = reps[2]; }
            reps[2] = reps[1];
          }
          reps[1] = reps[0]; reps[0] = d;
        }
        len = this.length(rc, this.repLen, posState);
        state = state < 7 ? 8 : 11;
      } else {
        reps[3] = reps[2]; reps[2] = reps[1]; reps[1] = reps[0];
        len = this.length(rc, this.len, posState);
        state = state < 7 ? 7 : 10;
        reps[0] = this.distance(rc, len);
        if (reps[0] === 0xffffffff) {
          if (!marker) fail("The LZMA data is damaged (an end marker where none belongs).");
          this.state = state;
          return true;
        }
      }
      len += 2;
      const d = reps[0] + 1;
      if (d > pos - this.dictStart) fail("The LZMA data is damaged (a distance too far back).");
      if (until !== Infinity && pos + len > until) fail("The LZMA data is damaged (a match past the end).");
      out.room(len);
      const b = out.buf;
      for (let k = 0; k < len; k++) { b[out.n] = b[out.n - d]; out.n++; }
    }
    this.state = state;
    return false;
  }
}

const props = (b) => {
  if (b >= 225) fail("The LZMA data has bad properties.");
  return [b % 9, Math.floor(b / 9) % 5, Math.floor(b / 45)];
};

export function unlzma(src, limit = 1 << 30) {
  if (src.length < 13) fail("The LZMA file is too short.");
  const [lc, lp, pb] = props(src[0]);
  const lo = src[5] | (src[6] << 8) | (src[7] << 16) | (src[8] << 24);
  const hi = src[9] | (src[10] << 8) | (src[11] << 16) | (src[12] << 24);
  const known = !(lo === -1 && hi === -1);
  const size = known ? (lo >>> 0) + (hi >>> 0) * 2 ** 32 : Infinity;
  if (known && size > limit) fail("The file unpacks too big.");
  const out = new Out(known ? size : src.length * 4);
  const z = new Lzma(out);
  z.setProps(lc, lp, pb);
  const rc = new Range(src, 13);
  z.run(rc, size, true); // an end marker may close it even with the size given
  if (out.n > limit) fail("The file unpacks too big.");
  return out.result();
}

// The xz stream (spec 1.0.4): header, blocks (each LZMA2), index, footer; streams may follow one another.
export function unxz(src, limit = 1 << 30) {
  const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
  const out = new Out(src.length * 4);
  let pos = 0;
  const varint = () => {
    let v = 0, mul = 1;
    for (let i = 0; i < 9; i++) {
      const b = src[pos++];
      v += (b & 0x7f) * mul; mul *= 128;
      if (!(b & 0x80)) return v;
    }
    return fail("The xz data is damaged.");
  };
  let streams = 0;
  while (pos < src.length) {
    if (streams && src[pos] === 0) { pos++; continue; } // stream padding
    if (!MAGIC.every((b, i) => src[pos + i] === b)) {
      if (streams) break;
      fail("That isn't xz data.");
    }
    streams++;
    const check = src[pos + 7] & 0x0f;
    const checkSize = check === 0 ? 0 : check <= 3 ? 4 : check <= 6 ? 8 : check <= 9 ? 16 : check <= 12 ? 32 : 64;
    pos += 12;
    for (;;) {
      const hs = src[pos];
      if (hs === undefined) fail("The xz data ends too soon.");
      if (hs === 0) break; // the index
      const hend = pos + (hs + 1) * 4;
      const flags = src[pos + 1];
      pos += 2;
      if (flags & 0x40) varint(); // compressed size
      if (flags & 0x80) varint(); // uncompressed size
      const nf = (flags & 3) + 1;
      let dictProp = null;
      for (let f = 0; f < nf; f++) {
        const id = varint(), ps = varint();
        if (id !== 0x21 || f !== nf - 1) fail("The xz data uses a filter this can't unpack (only LZMA2).");
        dictProp = src[pos];
        pos += ps;
      }
      if (dictProp === null || dictProp > 40) fail("The xz data is damaged.");
      pos = hend;
      pos = lzma2(src, pos, out, limit);
      while (pos % 4) pos++; // block padding (from the stream's start, which is 4-aligned in every file we read)
      pos += checkSize;
    }
    // index: indicator, records, padding, CRC32; then the 12-byte footer, whose backward size says the index's size
    pos++;
    const records = varint();
    for (let i = 0; i < records; i++) { varint(); varint(); }
    while (pos % 4) pos++;
    pos += 4 + 12;
  }
  if (out.n > limit) fail("The file unpacks too big.");
  return out.result();
}

// LZMA2 chunks into `out`; returns the position after the end byte.
function lzma2(src, pos, out, limit) {
  let z = null;
  for (;;) {
    const c = src[pos++];
    if (c === undefined) fail("The xz data ends too soon.");
    if (c === 0) return pos;
    if (c === 1 || c === 2) {
      const size = ((src[pos] << 8) | src[pos + 1]) + 1;
      pos += 2;
      if (pos + size > src.length) fail("The xz data ends too soon.");
      if (out.n + size > limit) fail("The file unpacks too big.");
      if (c === 1 && z) z.dictStart = out.n;
      out.bytes(src.subarray(pos, pos + size));
      pos += size;
      continue;
    }
    if (c < 0x80) fail("The xz data is damaged (a bad LZMA2 chunk).");
    const usize = ((c & 0x1f) << 16) + ((src[pos] << 8) | src[pos + 1]) + 1;
    const psize = ((src[pos + 2] << 8) | src[pos + 3]) + 1;
    pos += 4;
    const reset = (c >>> 5) & 3;
    if (!z) { if (reset < 2) fail("The xz data is damaged (no LZMA2 properties)."); z = new Lzma(out); }
    if (reset === 3) z.dictStart = out.n;
    if (reset >= 2) { const [lc, lp, pb] = props(src[pos++]); if (lc + lp > 4) fail("The xz data has bad LZMA2 properties."); z.setProps(lc, lp, pb); }
    else if (reset === 1) z.reset();
    if (out.n + usize > limit) fail("The file unpacks too big.");
    const end = pos + psize;
    if (end > src.length) fail("The xz data ends too soon.");
    const rc = new Range(src.subarray(0, end), pos);
    z.run(rc, out.n + usize, false);
    pos = end;
  }
}

// ---- by name, and the containers ------------------------------------------------------------------------------

export function decompress(name, data, limit = 1 << 30) {
  const n = name.toLowerCase();
  if (n.endsWith(".gz")) return gunzip(data, limit);
  if (n.endsWith(".xz")) return unxz(data, limit);
  if (n.endsWith(".lzma")) return unlzma(data, limit);
  if (n.endsWith(".zst") || n.endsWith(".zstd")) fail("This .deb is packed with zstd, which can't be unpacked here. Add its .dylib instead.");
  if (n.endsWith(".bz2")) fail("This .deb is packed with bzip2, which can't be unpacked here. Add its .dylib instead.");
  if (n.endsWith(".tar")) return data;
  return fail(`${name} is packed in a way this can't unpack.`);
}

const ascii = (b, s, e) => {
  let r = "";
  for (let i = s; i < e && b[i]; i++) r += String.fromCharCode(b[i]);
  return r;
};

export function readAr(src) {
  if (ascii(src, 0, 8) !== "!<arch>\n") fail("That isn't a .deb (no ar header).");
  const out = [];
  let pos = 8;
  while (pos + 60 <= src.length) {
    const name = ascii(src, pos, pos + 16).trim().replace(/\/$/, "");
    const size = parseInt(ascii(src, pos + 48, pos + 58).trim(), 10);
    if (!(size >= 0) || pos + 60 + size > src.length) fail("The .deb is damaged (an ar entry runs past its end).");
    out.push({ name, data: src.subarray(pos + 60, pos + 60 + size) });
    pos += 60 + size + (size & 1);
  }
  return out;
}

const octal = (b, s, e) => {
  if (b[s] & 0x80) { // base-256 (GNU, for big files)
    let v = 0;
    for (let i = s + 1; i < e; i++) v = v * 256 + b[i];
    return v;
  }
  const t = ascii(b, s, e).trim();
  return t ? parseInt(t, 8) : 0;
};

export function readTar(src) {
  const out = [];
  let pos = 0, longName = null, longLink = null, pax = {};
  const text = (d) => new TextDecoder().decode(d);
  while (pos + 512 <= src.length) {
    if (src.subarray(pos, pos + 512).every((b) => b === 0)) break;
    const size = octal(src, pos + 124, pos + 136);
    const type = String.fromCharCode(src[pos + 156] || 48);
    const data = src.subarray(pos + 512, pos + 512 + size);
    if (pos + 512 + size > src.length) fail("The .deb's archive is damaged (a file runs past its end).");
    const next = pos + 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = text(data).replace(/\0+$/, ""); pos = next; continue; }
    if (type === "K") { longLink = text(data).replace(/\0+$/, ""); pos = next; continue; }
    if (type === "x" || type === "g") {
      for (const rec of text(data).split("\n")) {
        const m = /^\d+ ([^=]+)=(.*)$/.exec(rec);
        if (m && type === "x") pax[m[1]] = m[2];
      }
      pos = next;
      continue;
    }
    let path = ascii(src, pos, pos + 100);
    if (ascii(src, pos + 257, pos + 262) === "ustar") {
      const prefix = ascii(src, pos + 345, pos + 500);
      if (prefix) path = `${prefix}/${path}`;
    }
    path = pax.path ?? longName ?? path;
    const link = pax.linkpath ?? longLink ?? ascii(src, pos + 157, pos + 257);
    const kind = type === "0" || type === "7" ? "file" : type === "5" ? "dir" : type === "2" ? "symlink" : type === "1" ? "link" : "other";
    out.push({ path: kind === "dir" ? path.replace(/\/+$/, "") : path, type: kind, data: kind === "file" ? data : new Uint8Array(0), link });
    longName = null; longLink = null; pax = {};
    pos = next;
  }
  return out;
}

export function readZip(src, limit = 1 << 30) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let eocd = -1;
  for (let i = src.length - 22; i >= Math.max(0, src.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail("That isn't a zip file.");
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > src.length || dv.getUint32(p, true) !== 0x02014b50) fail("The zip file is damaged.");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const flags = dv.getUint16(p + 8, true), attr = dv.getUint32(p + 38, true), local = dv.getUint32(p + 42, true);
    const path = new TextDecoder().decode(src.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (flags & 1) fail("The zip file is encrypted.");
    if (local + 30 > src.length) fail("The zip file is damaged.");
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = src.subarray(start, start + csize);
    const symlink = ((attr >>> 16) & 0o170000) === 0o120000;
    if (path.endsWith("/")) { out.push({ path, data: new Uint8Array(0), dir: true, symlink: false }); continue; }
    total += usize;
    if (total > limit) fail("The zip file unpacks too big.");
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = inflate(raw, usize || limit);
    else fail(`The zip file uses compression method ${method}, which this can't unpack.`);
    out.push({ path, data, dir: false, symlink });
  }
  return out;
}
