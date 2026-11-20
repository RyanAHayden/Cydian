// B127: no notice pushes the list down under a sticky section header. Sources' refresh strip is gone (the reload bar
// says what is happening, the rows show each source's state, the tab badge counts failures), and with it the 24px
// header offset that hung "Individual Sources" over the first row (B126). Every section header sticks at top: 0 of
// its own scroller, which is just under the nav bar, the search bar or the queue run's strip (they sit outside it or
// in its padding), so it sits flush whatever shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "");
const rulesOf = (src) => [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const cssFiles = readdirSync(new URL("./", import.meta.url)).filter((f) => f.endsWith(".css")).map((f) => "./" + f);
const css = cssFiles.flatMap((f) => rulesOf(strip(f)));
const top = (decl) => /(?:^|;)\s*top\s*:\s*([^;]+)/.exec(decl)?.[1].trim();

test("B127: no rule moves a section header's sticky top off 0", () => {
  const moved = css.filter((r) => /section-header|vlist-sticky/.test(r.sel) && top(r.decl) && top(r.decl) !== "0");
  assert.deepEqual(moved.map((r) => r.sel), []);
});

test("B126: headers stick at the top of their scroller", () => {
  const head = css.find((r) => r.sel === ".section-header" && top(r.decl));
  assert.equal(top(head.decl), "0");
  const vsticky = css.find((r) => r.sel === ".vlist-sticky");
  assert.equal(top(vsticky.decl), "0");
});

test("B127: Sources has no refresh strip: only its search bar is pinned above the list", () => {
  const src = read("./screens/sources.js");
  assert.match(src, /pinned\(el, bar\)/);
  assert.doesNotMatch(src, /refresh-strip|stripText|paintStrip/);
  assert.doesNotMatch(read("./core/refreshrows.js"), /stripText/);
  assert.equal(css.filter((r) => /refresh-strip/.test(r.sel)).length, 0, "no .refresh-strip CSS left");
});
