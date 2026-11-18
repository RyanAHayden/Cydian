// B51: the section index (A–Z down the right of Installed/Sources) ends above the reload bar while it shows, so Y, Z
// and # are not covered by the strip. It sits between the bars when idle; only its bottom changes, never the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rulesOf = (src) => [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const pkg = rulesOf(strip("./packages.css"));
const ios6 = rulesOf(strip("./ios6.css"));
const bottomOf = (decl) => /(?:^|;)\s*bottom\s*:\s*([^;]+)/.exec(decl)?.[1].trim();

test("B51: idle, the index ends 6 pt above the tab bar", () => {
  const idx = pkg.find((r) => r.sel === ".section-index");
  assert.ok(idx, ".section-index missing");
  assert.match(idx.decl, /position\s*:\s*absolute/);
  assert.equal(bottomOf(idx.decl), "calc(var(--tab-h) + 6px)");
});

test("B51: while the reload bar shows, the index ends 6 pt above the strip, not behind it", () => {
  const bar = ios6.find((r) => r.sel === ".reload-bar");
  const barH = Number(/(?:^|;)\s*height\s*:\s*(\d+)px/.exec(bar.decl)?.[1]);
  assert.match(bar.decl, /bottom\s*:\s*var\(--tab-h\)/, "the strip sits right on the tab bar");
  const r = pkg.find((x) => x.sel === "html.has-reload .section-index");
  assert.ok(r, "no has-reload rule for the index");
  assert.equal(bottomOf(r.decl), `calc(var(--tab-h) + ${barH}px + 6px)`);
  assert.deepEqual(r.decl.split(";").map((d) => d.split(":")[0].trim()).filter(Boolean), ["bottom"], "only its bottom changes");
});
