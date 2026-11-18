// R12: time core/catalog.js search() per keystroke with every default source loaded.
//   node journal/2026-11-18-r12-search-cost/bench.mjs DATA_DIR [arch]
// arch "both" loads each APT source twice (arm and arm64), the heaviest default load.
// DATA_DIR holds the default APT sources' Packages, decompressed (telesphoreo, bigboss, chariz, havoc, procursus)
// and the default AltStore sources as alt*.json. arch: iphoneos-arm64 (default, a modern phone) or iphoneos-arm.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCatalog } from "../../web/app/core/catalog.js";
import { detectJson } from "../../web/app/core/sources/detect.js";

const dir = process.argv[2];
const arch = process.argv[3] ?? "iphoneos-arm64";
const c = createCatalog();
let total = 0;
for (const f of readdirSync(dir).sort()) {
  if (/\.(xz|bz2|gz)$/.test(f)) continue;
  const text = readFileSync(join(dir, f), "utf8");
  let n;
  if (f.endsWith(".json")) {
    let json; try { json = JSON.parse(text); } catch { console.log(`${f}: not JSON, skipped`); continue; }
    const d = detectJson(json);
    const fmt = typeof d === "string" ? d : d?.format ?? null;
    try { n = c.loadAlt(`alt:${f}`, json, null, fmt); } catch (e) { console.log(`${f}: ${e.message}`); continue; }
  } else if (arch === "both") {
    // worst case: every APT source read for both architectures, as two sources (rows merge by id)
    n = c.load(f, text, "https://example.invalid/", "iphoneos-arm") + c.load(`${f}-arm64`, text, "https://example.invalid/", "iphoneos-arm64");
  } else n = c.load(f, text, "https://example.invalid/", arch);
  total += n;
  console.log(`${f}: ${n}`);
}
console.log(`loaded ${total} rows (${arch}), ${c.list().length} after merging`);

const queries = ["snowboard", "youtube", "music player", "theme", "cydia", "a"];
const runs = 15;
const per = [];
for (const q of queries) {
  for (let i = 1; i <= q.length; i++) {
    const p = q.slice(0, i);
    if (!p.trim()) continue;
    const ts = [];
    let hits = 0;
    for (let r = 0; r < runs; r++) {
      const t = performance.now();
      hits = c.search(p).length;
      ts.push(performance.now() - t);
    }
    ts.sort((a, b) => a - b);
    per.push({ q: p, hits, median: ts[runs >> 1], max: ts[runs - 1] });
  }
}
for (const r of per) console.log(`${JSON.stringify(r.q).padEnd(16)} hits ${String(r.hits).padStart(5)}  median ${r.median.toFixed(2)} ms  max ${r.max.toFixed(2)} ms`);
const meds = per.map((r) => r.median).sort((a, b) => a - b);
console.log(`keystrokes ${per.length}: median of medians ${meds[meds.length >> 1].toFixed(2)} ms, worst median ${meds.at(-1).toFixed(2)} ms`);
