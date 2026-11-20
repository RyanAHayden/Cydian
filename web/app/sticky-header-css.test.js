// B126: Sources' refresh strip (F233) only offsets the sticky section headers that scroll in the same box as the
// strip. On the pinned layout (nav/searchbar.js pinned: the strip and the search bar sit above .search-results, the
// list's own scroller) the headers keep top: 0, so they sit flush under the bar whether the strip shows or not; the
// old 24px offset hung "Individual Sources" over the first row while the strip showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rulesOf = (src) => [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const css = ["./ios6.css", "./style.css", "./packages.css", "./sources.css"].flatMap((f) => rulesOf(strip(f)));
const top = (decl) => /(?:^|;)\s*top\s*:\s*([^;]+)/.exec(decl)?.[1].trim();

test("B126: every rule that moves a section header's sticky top leaves the pinned layout out", () => {
  const moved = css.filter((r) => /section-header/.test(r.sel) && top(r.decl) && top(r.decl) !== "0");
  assert.ok(moved.length, "the refresh strip's header offset rule is gone: update this test");
  for (const r of moved) {
    for (const sel of r.sel.split(",")) {
      assert.match(sel, /:not\(\.search-root\)/, `${sel.trim()} offsets headers inside .search-results too`);
    }
  }
});

test("B126: headers stick at the top of their scroller", () => {
  const head = css.find((r) => r.sel === ".section-header" && top(r.decl));
  assert.equal(top(head.decl), "0");
  const vsticky = css.find((r) => r.sel === ".vlist-sticky");
  assert.equal(top(vsticky.decl), "0");
});

test("B126: Sources pins its refresh strip above the list's scroller", () => {
  const src = readFileSync(new URL("./screens/sources.js", import.meta.url), "utf8");
  assert.match(src, /pinned\(el, strip, bar\)/);
});
