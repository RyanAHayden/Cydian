// R44 harness: frame times of a ticking label under nav/slide.js's watcher, on the phone's own WebKit.
// Runs every (variant, scenario) pair, one per page load (each variant installs its own observers on body), keeps
// results in localStorage and draws a table at the end. See ../README.md for how it was run.
//
// Variants: base (no watcher), a (slide.js as on main), b (slide.js with text-only mutations left to the
// ResizeObserver). Scenarios: tick40 / tick500 (a .cell-detail's textContent set every frame on a 40- / 500-row
// page), cd500 (the same through a text node's .data: characterData records), wrap40 (the first group's footer
// toggles between one and three lines every 400 ms on a page of 10 groups of 4 rows: the watcher must still slide
// the groups under it).

const KEY = "r44.results";
const VARIANTS = ["base", "a", "b"];
const SCENARIOS = ["tick40", "tick500", "cd500", "wrap40"];
const RUN_MS = 4000;
const RUNS = [];
for (let rep = 0; rep < 2; rep++) for (const s of SCENARIOS) for (const v of VARIANTS) RUNS.push(`${v}:${s}:${rep}`);

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (r) => localStorage.setItem(KEY, JSON.stringify(r));

// ---- instrumentation: time every observer callback, count getComputedStyle calls and animations started ----
const stats = { obsMs: 0, obsCalls: 0, obsMax: 0, cs: 0, anims: 0 };
const timed = (Base) => class extends Base {
  constructor(cb) {
    super((...args) => {
      const t = performance.now();
      try { cb(...args); } finally {
        const d = performance.now() - t;
        stats.obsMs += d; stats.obsCalls++; if (d > stats.obsMax) stats.obsMax = d;
      }
    });
  }
};
globalThis.MutationObserver = timed(MutationObserver);
if (globalThis.ResizeObserver) globalThis.ResizeObserver = timed(ResizeObserver);
const realCs = globalThis.getComputedStyle.bind(globalThis);
globalThis.getComputedStyle = (el, p) => { stats.cs++; return realCs(el, p); };
const realAnimate = Element.prototype.animate;
Element.prototype.animate = function (...a) { stats.anims++; return realAnimate.apply(this, a); };

// ---- the page, built like nav/ui.js grouped() ----
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function row(label, detail) {
  const li = el("li", "cell");
  const inner = el("div", "cell-inner");
  const t = el("span", "cell-text");
  t.append(el("span", "cell-label", label));
  inner.append(t, el("span", "cell-detail", detail));
  li.append(inner);
  return li;
}
function page(rows, per = 50) {
  const stack = el("div", "tab-stack is-active");
  const pg = el("div", "page is-top");
  const body = el("div", "page-body");
  for (let g = 0; g * per < rows; g++) {
    const group = el("div", "group");
    group.append(el("h2", "group-header", `Group ${g + 1}`));
    const ul = el("ul", "table grouped");
    for (let i = g * per; i < Math.min(rows, (g + 1) * per); i++) ul.append(row(`Row ${i + 1}`, String(i)));
    group.append(ul, el("p", "group-footer", "A footer under the group."));
    body.append(group);
  }
  pg.append(body);
  stack.append(pg);
  document.getElementById("screens").append(stack);
  return body;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(variant, scenario) {
  if (variant !== "base") {
    const m = await import(variant === "a" ? "./slide-a.js" : "./slide-b.js");
    m.installSlides(document);
  }
  const rows = scenario.endsWith("500") ? 500 : 40;
  const body = page(rows, scenario === "wrap40" ? 4 : 50);
  await sleep(600); // first measure, first ResizeObserver reports
  const target = body.querySelectorAll(".cell-detail")[2];
  const label = body.querySelector(".group-footer"); // wraps: the groups under it must slide
  const textNode = target.firstChild;
  const long = "A label long enough to wrap onto a second line on this phone, and then a little more";
  for (const k of Object.keys(stats)) stats[k] = 0;
  const gaps = [];
  let last = await nextFrame();
  const start = last;
  let n = 0;
  let wrapAt = start;
  while (last - start < RUN_MS) {
    n++;
    if (scenario === "cd500") textNode.data = `${n} items`;
    else if (scenario === "wrap40") {
      if (last - wrapAt >= 400) { wrapAt = last; label.textContent = label.textContent === long ? "Short" : long; }
    } else target.textContent = `${n} items`;
    const t = await nextFrame();
    gaps.push(t - last);
    last = t;
  }
  gaps.sort((x, y) => x - y);
  const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
  return {
    frames: gaps.length, fps: +(1000 * gaps.length / (last - start)).toFixed(1),
    p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +gaps[gaps.length - 1].toFixed(1),
    long: gaps.filter((g) => g > 25).length,
    obsMs: +stats.obsMs.toFixed(1), obsCalls: stats.obsCalls, obsMax: +stats.obsMax.toFixed(2),
    csPerFrame: +(stats.cs / gaps.length).toFixed(0), anims: stats.anims,
  };
}

function table(results) {
  const out = el("pre", "r44-out");
  out.style.cssText = "position:fixed;inset:0;z-index:99;margin:0;padding:24px 4px;background:#fff;color:#000;font:9px/1.25 Menlo,monospace;white-space:pre;overflow:auto";
  const cols = ["fps", "p50", "p95", "max", "long", "obsMs", "obsCalls", "obsMax", "csPerFrame", "anims"];
  const lines = [["run", ...cols].join(" ")];
  for (const id of RUNS) { const r = results[id]; lines.push([id, ...cols.map((c) => r ? r[c] : "-")].join(" ")); }
  out.textContent = `R44 ${navigator.userAgent.match(/OS [\d_]+/)?.[0] ?? ""} done\n` + lines.join("\n");
  document.body.append(out);
  console.log(JSON.stringify(results));
}

(async () => {
  const results = load();
  if (location.hash === "#reset") { save({}); location.hash = ""; location.reload(); return; }
  const todo = RUNS.find((id) => !results[id]);
  if (!todo) { table(results); return; }
  const [v, s] = todo.split(":");
  const tag = el("div", null, `R44 running ${todo} (${RUNS.indexOf(todo) + 1}/${RUNS.length})`);
  tag.style.cssText = "position:fixed;left:0;right:0;bottom:60px;z-index:99;background:#000;color:#fff;font:14px Menlo,monospace;padding:6px";
  document.body.append(tag);
  results[todo] = await run(v, s);
  save(results);
  await sleep(300);
  location.reload();
})();
