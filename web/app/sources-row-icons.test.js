// B253: the Sources tab's rows share one icon column. The source rows are the reference: a 29pt .cell-icon at the
// cell's padding, the title one --cell-gap after it. The All Sources folder (32pt in Sections) and More Sources' plus
// tile (a Settings .row-icon, nudged 3pt left by --row-icon-in) are brought onto it, so every icon has the same size
// and left edge and every title starts at the same x. Rendered check: journal/2026-11-21-b253-sources-row-icons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const rulesOf = (file) => {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
};
const last = (rules, sel, prop) => {
  let v;
  for (const r of rules.filter((x) => x.sel.split(",").map((s) => s.trim()).includes(sel))) {
    for (const m of r.decl.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))) v = m[1].trim();
  }
  return v;
};

test("the Sources tab's list carries the class the alignment rules hang on", () => {
  assert.match(read("./screens/sources.js"), /ul\.classList\.add\("sources-list"\)/);
});

test("the All Sources folder is drawn at the source icons' size", () => {
  const style = rulesOf("./style.css");
  const pk = rulesOf("./packages.css");
  const w = last(style, ".cell-icon", "width");
  const h = last(style, ".cell-icon", "height");
  assert.equal(w, "29px", "the source rows' icon");
  assert.equal(h, "29px");
  const sel = ".sources-list .all-sources-row .folder";
  assert.equal(last(pk, sel, "width"), w);
  assert.equal(last(pk, sel, "height"), h);
  assert.equal(last(pk, sel, "background-size"), `${w} ${h}`, "the folder art scales with its box, not cropped");
  // it sits where a .cell-icon does: no margin of its own, so the cell's padding and gap place it and its title
  assert.equal(last(pk, sel, "margin"), undefined);
  assert.equal(last(pk, ".folder", "margin"), undefined);
});

test("More Sources' plus tile drops the Settings-table nudge and sits on the source icons' edge", () => {
  const pk = rulesOf("./packages.css");
  assert.equal(last(pk, ".sources-list .more-sources-row .cell-icon.row-icon", "margin"), "0");
  // the tile itself is the source icons' size
  const style = rulesOf("./style.css");
  assert.equal(last(style, ".cell-icon.row-icon img", "width"), last(style, ".cell-icon", "width"));
  assert.equal(last(style, ".cell-icon.row-icon img", "height"), last(style, ".cell-icon", "height"));
  // and it is the row's .row-icon (moresources.js moreRow)
  assert.match(read("./screens/moresources.js"), /icon: rowIcon\("moreSources"\), cls: "more-sources-row"/);
});
