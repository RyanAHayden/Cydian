// QR codes for Sources > Manage > Import & Export (F45): the exported list as a code another phone's camera reads.
// Pure JS, no DOM. Byte mode (UTF-8, with an ECI header when it isn't ASCII), any version 1-40, error correction L or M, mask chosen by the standard's
// penalty rules (ISO/IEC 18004). After Project Nayuki's QR Code generator (MIT), written fresh for this file.
//
//   qrMatrix(text, { ecc: "M" }) -> { size, version, get(x, y) -> true for a dark module }   throws when too long
//   qrSvg(text, opts)            -> an <svg> string, a quiet zone of 4 modules around the code

const ECC = { L: { bits: 1, i: 0 }, M: { bits: 0, i: 1 } };
// Per version (index 1-40): error correction codewords per block, and block count, for L and M.
const EC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
];
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
];

function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - EC_PER_BLOCK[e][ver] * BLOCKS[e][ver];

// GF(256) with 0x11D.
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = mul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= mul(c, f)));
  }
  return r;
}

function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

export function qrMatrix(text, { ecc = "M" } = {}) {
  const e = ECC[ecc] ? ECC[ecc].i : 1;
  const eccBits = (ECC[ecc] ?? ECC.M).bits;
  const bytes = [...new TextEncoder().encode(String(text))];
  const eci = bytes.some((b) => b > 0x7f); // UTF-8 ECI (26) first, or scanners read the bytes as Shift JIS
  let ver = 1;
  for (; ver <= 40; ver++) {
    const cap = dataCodewords(ver, e) * 8;
    if ((eci ? 12 : 0) + 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
  }
  if (ver > 40) throw new Error("Too long for a QR code");

  // Data bits: mode 0100, length, bytes, terminator, pad to bytes, pad codewords.
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  if (eci) { put(7, 4); put(26, 8); }
  put(4, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Blocks with their error correction, interleaved.
  const nBlocks = BLOCKS[e][ver];
  const ecLen = EC_PER_BLOCK[e][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortCount = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(ecLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const d = data.slice(k, k + shortLen - ecLen + (i < shortCount ? 0 : 1));
    k += d.length;
    const ec = rsRemainder(d, div);
    if (i < shortCount) d.push(-1); // a gap, so every block lines up
    blocks.push([...d, ...ec]);
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) if (i !== shortLen - ecLen || j >= shortCount) codewords.push(blocks[j][i]);
  }

  const size = ver * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { dark[y][x] = v; fixed[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignPositions(ver);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mask) => {
    const d = (eccBits << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0); // reserve
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const v = ((b >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, v); set(c, a, v);
    }
  }

  // Codewords in the zigzag, right to left in column pairs, skipping the timing column.
  let i = 0;
  const cwBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const up = ((right + 1) & 2) === 0;
      const y = up ? size - 1 - vert : vert;
      if (!fixed[y][x] && i < cwBits) { dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) dark[y][x] = !dark[y][x];
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); format(m);
    const s = penalty(dark, size);
    if (s < bestScore) { bestScore = s; best = m; }
    applyMask(m);
  }
  applyMask(best); format(best);
  return { size, version: ver, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && dark[y][x] };
}

function penalty(dark, size) {
  let score = 0;
  const line = (get) => {
    let s = 0, run = 1;
    const seq = [];
    for (let i = 0; i < size; i++) seq.push(get(i));
    for (let i = 1; i <= size; i++) {
      if (i < size && seq[i] === seq[i - 1]) { run++; continue; }
      if (run >= 5) s += run - 2;
      run = 1;
    }
    // finder-like 1:1:3:1:1 with 4 light on a side
    const str = seq.map((v) => (v ? "1" : "0")).join("");
    for (const pat of ["00001011101", "10111010000"]) {
      let k = str.indexOf(pat);
      while (k !== -1) { s += 40; k = str.indexOf(pat, k + 1); }
    }
    return s;
  };
  for (let y = 0; y < size; y++) score += line((x) => dark[y][x]);
  for (let x = 0; x < size; x++) score += line((y) => dark[y][x]);
  let darkCount = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (dark[y][x]) darkCount++;
    if (x < size - 1 && y < size - 1) {
      const c = dark[y][x];
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
    }
  }
  const total = size * size;
  score += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
  return score;
}

export function qrSvg(text, opts = {}) {
  const m = qrMatrix(text, opts);
  const q = 4, n = m.size + q * 2;
  let d = "";
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
