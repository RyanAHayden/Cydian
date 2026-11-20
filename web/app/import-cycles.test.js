// C24: no static import cycle in web/app. A cycle makes load order matter (a module can run before one it imports
// has set its exports) and ties files together that should load apart (lazy.js). Shared state or small controls a
// screen needs from another screen go in their own module (settings-store.js, nav/switch.js), not through the screen.
// Static imports only, as module-graph.test.js reads them: import() is lazy and can't deadlock a load.
// KNOWN lists the cycles that were there when this test came in; each has a cleanup task. When one is broken, drop
// its line here (the test fails while a listed cycle is gone, so the list only shrinks). Never add a line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const KNOWN = [
  "screens/browse.js screens/manage.js screens/roulette.js",
];

const STATIC = /^[ \t]*(?:import|export)\s+(?:[^'"`;()]*?\s+from\s+)?["']([^"']+)["']/gm;

// The shipped modules: every .js under web/app but tests, test helpers and vendor/.
export function appModules(dir = root) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor" && e.name !== "node_modules") out.push(...appModules(p)); }
    else if (e.name.endsWith(".js") && !/\.test(-helper)?\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

// graph: Map file -> [files it imports]. Returns the strongly connected components that are cycles (Tarjan), each as
// its files' sorted paths relative to `base`, joined by spaces.
export function findCycles(graph, base = root) {
  let n = 0;
  const index = new Map(), low = new Map(), stack = [], on = new Set(), cycles = [];
  const visit = (v) => {
    index.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) !== index.get(v)) return;
    const scc = [];
    let w;
    do { w = stack.pop(); on.delete(w); scc.push(w); } while (w !== v);
    if (scc.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(scc.map((f) => relative(base, f)).sort().join(" "));
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return cycles.sort();
}

function appGraph() {
  const graph = new Map();
  for (const f of appModules()) {
    graph.set(f, [...readFileSync(f, "utf8").matchAll(STATIC)].map((m) => m[1]).filter((s) => s.startsWith("."))
      .map((s) => resolve(dirname(f), s)).filter((p) => existsSync(p)));
  }
  return graph;
}

test("findCycles: finds a loop, a self-import and nothing in a tree", () => {
  const g = new Map([["/a", ["/b"]], ["/b", ["/c"]], ["/c", ["/a"]], ["/d", ["/d"]], ["/e", ["/a", "/f"]], ["/f", []]]);
  assert.deepEqual(findCycles(g, "/"), ["a b c", "d"]);
  assert.deepEqual(findCycles(new Map([["/x", ["/y"]], ["/y", []]]), "/"), []);
});

test("no new import cycle in web/app (and every known one is still there, or drop its line)", () => {
  assert.deepEqual(findCycles(appGraph()), [...KNOWN].sort());
});

test("screens/settings.js is in no cycle: the store and the switch are imported from their own modules", () => {
  const cycles = findCycles(appGraph());
  assert.deepEqual(cycles.filter((c) => c.split(" ").includes("screens/settings.js")), []);
  for (const f of appModules()) {
    if (f.endsWith("screens/settings.js") || f.endsWith("app.js")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/^[ \t]*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm)) {
      if (resolve(dirname(f), m[2]) !== join(root, "screens/settings.js")) continue;
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      assert.ok(!names.includes("settings") && !names.includes("createSwitch"),
        `${relative(root, f)} imports settings/createSwitch from screens/settings.js: use settings-store.js / nav/switch.js`);
    }
  }
});
