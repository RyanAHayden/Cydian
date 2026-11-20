// B125: on a page with the pinned search bar (nav/searchbar.js pinned: Sources, Search, Changes, Installed, My IPAs)
// the results scroller runs to the bottom of the screen and scrolls under the tab bar, like every .page-body. The tab
// bar's room is the scroller's own bottom padding; on the page body it stopped the scroller short and the body's
// white showed as a strip over the last row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rulesOf = (src) => [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const pkg = rulesOf(strip("./packages.css"));
const style = rulesOf(strip("./style.css"));
const prop = (decl, name) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(decl)?.[1].trim();
const rule = (rules, sel) => rules.find((r) => r.sel === sel);

test("B125: the pinned page body gives up its bottom padding", () => {
  const pads = pkg.filter((r) => r.sel === ".page-body.search-root:has(> .search-results)").map((r) => prop(r.decl, "padding-bottom")).filter(Boolean);
  assert.deepEqual(pads, ["0"]);
});

test("B125: the results scroller carries the page body's end room (tab bar + 20px)", () => {
  const body = rule(style, ".page-body");
  const pad = /calc\(var\(--tab-h\) \+ 20px\)/.exec(prop(body.decl, "padding"))?.[0];
  assert.ok(pad, ".page-body's bottom padding changed: update this test and the pinned rule together");
  const r = rule(pkg, ".search-root > .search-results");
  assert.ok(r, "no pinned results padding rule");
  assert.equal(prop(r.decl, "padding-bottom"), pad);
});

test("B125: end-room blocks (reload strip, Manage toolbar) go in the results, never the pinned flex column", () => {
  const r = rule(pkg, ".page-body.search-root:has(> .search-results)::after");
  assert.ok(r, "the pinned page body's ::after is not turned off");
  assert.equal(prop(r.decl, "display"), "none");
  const m = rule(pkg, "html.has-manage-toolbar .search-results::after");
  assert.ok(m, "Manage's toolbar room is missing from the results");
  assert.equal(prop(m.decl, "height"), "44px");
});
