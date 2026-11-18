// F101: old vs new catalog search on a synthetic 12,919-row catalog (4 overlapping sources).
// Run from the repo root after `git show <base>:web/app/core/catalog.js > web/app/core/_f101_old_catalog.js`
// (delete it after): node journal/2026-11-18-f101-search-ranking/bench.mjs
import { createCatalog as mkNew } from "../../web/app/core/catalog.js";
import { createCatalog as mkOld } from "../../web/app/core/_f101_old_catalog.js";
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const syl = ["snow","board","tube","you","music","play","er","theme","cyd","ia","flex","lock","screen","spring","dock","icon","bar","pro","lite","kit","app","tweak","noti","fy","color","dark","mode","glass","pad","key","home","swipe","gest","ure","volt","zen","nova","aura","pix","cam"];
const word = () => { let w = ""; const n = 1 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) w += syl[Math.floor(rnd() * syl.length)]; return w; };
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const all = [];
for (let i = 0; i < 12919; i++) {
  const n = 1 + Math.floor(rnd() * 3); const name = Array.from({ length: n }, () => cap(word())).join(" ");
  all.push(`Package: com.${word()}.${name.toLowerCase().replace(/ /g, "")}${i}\nName: ${name}\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nAuthor: ${cap(word())} Dev\nDescription: ${word()} ${word()} ${word()}\n long ${word()} ${word()} text`);
}
const chunks = [all, all.filter((_, i) => i % 3 === 0), all.filter((_, i) => i % 5 === 0), all.filter((_, i) => i % 7 === 0)].map((l) => l.join("\n\n") + "\n");
const queries = [..."snowboard"].map((_, i) => "snowboard".slice(0, i + 1)).concat(["t","th","the","y","yo","a","ab","e","er","雪"]);
for (const [label, mk] of [["old", mkOld], ["new", mkNew], ["old", mkOld], ["new", mkNew]]) {
  const c = mk(); chunks.forEach((t, k) => c.load("s" + k, t, null));
  const out = [];
  for (const q of queries) {
    const ts = []; let hits = 0;
    for (let r = 0; r < 21; r++) { const t = performance.now(); hits = c.search(q).length; ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b); out.push(`${q}:${hits}:${ts[10].toFixed(2)}`);
  }
  console.log(label, c.list().length, out.join("  "));
}
