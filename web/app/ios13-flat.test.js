// B241: iOS 13 draws no iOS 6 parts on Installed, Changes and Settings: iOS 7's 51 x 31 switch geometry, flat
// signature pills (packages.css's --sig-pill* tokens), a flat banner and reload bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const ios13 = read("./ios13.css");
const ios7 = read("./ios7.css");
const packages = read("./packages.css");

// The declarations of the first block whose selector is exactly `sel`.
function block(css, sel) {
  const i = css.indexOf(sel + " {");
  assert.ok(i >= 0, `no block ${sel}`);
  const open = css.indexOf("{", i);
  return css.slice(open + 1, css.indexOf("\n}", open));
}
const value = (decls, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(decls)?.[1].trim();

test("iOS 13's switch takes iOS 7's 51 x 31 geometry hooks", () => {
  const h13 = block(ios13, 'html[data-style="ios13"]');
  const h7 = block(ios7, 'html[data-style="ios7"]');
  for (const t of ["--sw-w", "--sw-h", "--sw-knob-size", "--sw-travel"]) {
    assert.ok(value(h7, t), `ios7.css sets ${t}`);
    assert.equal(value(h13, t), value(h7, t), t);
  }
});

test("packages.css draws the signature pills from tokens only", () => {
  const stretch = packages.slice(packages.indexOf("look-only { ==== a signature's days left"));
  const rules = stretch.slice(stretch.indexOf(".sig-pill, .cell"), stretch.indexOf(".dep-rating {"));
  for (const t of ["--sig-pill", "--sig-pill-soon", "--sig-pill-expired", "--sig-pill-unknown", "--sig-pill-shadow"]) {
    assert.ok(new RegExp(`var\\(${t}\\)`).test(rules), `a rule reads ${t}`);
  }
  assert.doesNotMatch(rules, /gradient\(/, "no literal gloss left in the pill rules");
});

test("both iOS 13 tones make the pills, banner and reload bar flat", () => {
  for (const tone of ["light", "dark"]) {
    const d = block(ios13, `html[data-style="ios13"][data-theme="${tone}"]`);
    for (const t of ["--sig-pill", "--sig-pill-soon", "--sig-pill-expired", "--sig-pill-unknown", "--tweak-pill", "--tweak-pill-up"]) {
      assert.match(value(d, t) ?? "", /^#[0-9a-f]{6}$/, `${tone} ${t} is a flat colour`);
    }
    for (const t of ["--sig-pill-shadow", "--tweak-pill-shadow", "--banner-shadow", "--banner-emboss", "--reload-emboss"]) {
      assert.equal(value(d, t), "none", `${tone} ${t}`);
    }
    assert.match(value(d, "--banner") ?? "", /^#[0-9a-f]{6}$/, `${tone} banner is flat`);
    assert.doesNotMatch(value(d, "--reload-bar") ?? "gradient(", /gradient\(#|rgba\(76/, `${tone} reload bar has no gloss`);
  }
});
