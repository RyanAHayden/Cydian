// iOS 7 era, Sources tab: the All Sources row's keyline starts at its title like the source rows' below. ios7.css
// moves a plain row's keyline to the title for rows with a .cell-icon; the All Sources folder is a .folder (29pt on
// this tab, packages.css), so the row is named in the same rule. Rendered check: journal/2026-11-21-b255-all-sources-keyline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("iOS 7: the All Sources row shares the icon rows' keyline offset", () => {
  const css = read("./ios7.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .find(([, sel]) => sel.split(",").map((s) => s.trim()).includes('html[data-style="ios7"] .plain .cell:has(> .cell-inner > .cell-icon)'));
  assert.ok(rule, "the icon rows' keyline rule");
  const sels = rule[1].split(",").map((s) => s.trim());
  assert.ok(sels.includes('html[data-style="ios7"] .sources-list .all-sources-row'), "the All Sources row is in it");
  assert.match(rule[2], /background-position:\s*calc\(15px \+ 29px \+ var\(--cell-gap\)\)/);
  // the offset assumes a 29pt icon: the folder is that size on this tab
  assert.match(read("./packages.css"), /\.sources-list \.all-sources-row \.folder \{ width: 29px; height: 29px;/);
});
