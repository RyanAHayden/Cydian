// B242: Sources' failed-row badge (packages.css .row-failed-badge) reads --row-failed-badge* tokens; iOS 13 makes
// it flat systemRed with no shadow, in both tones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const ios13 = read("./ios13.css");
const packages = read("./packages.css");

function block(css, sel) {
  const i = css.indexOf(sel + " {");
  assert.ok(i >= 0, `no block ${sel}`);
  const open = css.indexOf("{", i);
  return css.slice(open + 1, css.indexOf("\n}", open));
}
const value = (decls, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(decls)?.[1].trim();

test("packages.css draws the failed-row badge from tokens only", () => {
  // the look-only rule is the last one with this selector (the first holds only its size)
  const rule = packages.slice(packages.lastIndexOf(".source-row.is-failed .cell-count.row-failed-badge {"));
  const decls = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
  assert.match(decls, /font-size/, "found the look-only rule");
  assert.equal(value(decls, "background"), "var(--row-failed-badge)");
  assert.equal(value(decls, "box-shadow"), "var(--row-failed-badge-shadow)");
  assert.match(packages, /--row-failed-badge:\s*linear-gradient\(/, "iOS 6 keeps the gloss as the token's default");
});

test("both iOS 13 tones make the failed-row badge flat systemRed", () => {
  const red = { light: "#ff3b30", dark: "#ff453a" };
  for (const tone of ["light", "dark"]) {
    const d = block(ios13, `html[data-style="ios13"][data-theme="${tone}"]`);
    assert.equal(value(d, "--row-failed-badge"), red[tone], `${tone} badge`);
    assert.equal(value(d, "--row-failed-badge-shadow"), "none", `${tone} badge shadow`);
  }
});
