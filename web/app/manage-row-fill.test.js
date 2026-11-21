// My IPAs' Edit rows wear .manage-row, so they take Installed's Manage fill: one fill on the row only (never on the
// slid .cell-inner too, which left the circle's strip another shade in dark), the same held as picked, in every era.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("myipas.css paints no picked fill of its own (no row and .cell-inner pair)", () => {
  const css = stripComments(read("./myipas.css"));
  assert.doesNotMatch(css, /\.myipa-row\.picked[^{]*\{[^}]*background/);
});

test("the row JS gives My IPAs' rows .manage-row, so the shared rules reach them", () => {
  assert.match(read("./screens/myipas.js"), /"myipa-row",[^)]*"manage-row"/);
});

for (const [file, sel] of [
  ["./packages.css", ".managing .manage-row:is(.picked, :has(> .cell-inner.is-pressed)) {"],
  ["./ios7.css", 'html[data-style="ios7"][data-theme] .managing .manage-row.picked,\nhtml[data-style="ios7"][data-theme] .managing .manage-row:has(> .cell-inner.is-pressed) {'],
  ["./ios13.css", 'html[data-style="ios13"][data-theme] .managing .manage-row.picked,\nhtml[data-style="ios13"][data-theme] .managing .manage-row:has(> .cell-inner.is-pressed) {'],
]) {
  test(`${file}: the Manage fill is on the row, held as picked, never on its .cell-inner`, () => {
    const css = stripComments(read(file));
    assert.ok(css.includes(sel), `no rule ${sel}`);
    assert.doesNotMatch(css, /\.(manage|myipa)-row\.picked \.cell-inner/);
  });
}

test("ios6.css keeps the blue press off Manage rows", () => {
  const css = read("./ios6.css");
  assert.ok(css.includes(".cell-inner.is-pressed:not(:where(.managing .manage-row > *)) { background: var(--select)"));
});
