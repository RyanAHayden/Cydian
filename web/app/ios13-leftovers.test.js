// B270: the iOS 13 (and iOS 7) leftovers that still drew iOS 6: Home's tiles, Manage's select circle and red Delete,
// and the alert. Checks that each era sheet carries its own rule for them, flat, in both tones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const sheets = { ios13: read("./ios13.css"), ios7: read("./ios7.css") };

// The declarations of the first rule whose selector list contains `sel`.
function decls(css, sel) {
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `no rule for ${sel}`);
  const open = css.indexOf("{", i);
  return css.slice(open + 1, css.indexOf("}", open));
}

test("iOS 13's Home tiles are inset 16pt, outline-free 10pt cards, the GitHub | Discord pair filled", () => {
  const css = sheets.ios13;
  assert.match(css, /html\[data-style="ios13"\] \{ --home-inset:\s*16px; \}/);
  const home = decls(css, 'html[data-style="ios13"] .home {');
  assert.match(home, /--tile-edge:\s*transparent/);
  assert.match(home, /--tile-radius:\s*10px/);
  assert.match(decls(css, 'html[data-style="ios13"] .home-row.pair > .table'), /background:\s*var\(--tile\)/);
  const split = decls(css, 'html[data-style="ios13"] .home-links .home-pair > .cell + .cell');
  assert.match(split, /border-left:\s*\.5px solid var\(--divider\)/);
  assert.match(split, /background:\s*none/, "no inset separator drawn on the right half");
});

for (const [era, css] of Object.entries(sheets)) {
  const pre = `html[data-style="${era}"][data-theme]`;
  const tint = era === "ios13" ? "--i13-tint" : "--i7-tint";
  const red = era === "ios13" ? "--i13-red" : "--i7-red";

  test(`${era}: Manage's select circle is a plain ring, picked a tinted disc with a white tick (no iOS 6 red gloss)`, () => {
    assert.match(decls(css, `${pre} .manage-check {`), /box-shadow:\s*none/);
    const picked = decls(css, `${pre} .manage-row.picked .manage-check`);
    assert.match(picked, new RegExp(`background:\\s*var\\(${tint}\\) url\\(`));
    assert.match(picked, /stroke='%23fff'/);
    assert.doesNotMatch(picked, /#900413|#a4313e/);
  });

  test(`${era}: Manage's Delete is flat red text on a flat toolbar`, () => {
    const del = decls(css, `${pre} .manage-toolbar .bar-button.manage-delete:not(.back):not(.done)`);
    assert.match(del, new RegExp(`color:\\s*var\\(${red}\\)`));
    assert.match(del, /background:\s*none/);
    assert.doesNotMatch(decls(css, `${pre} .manage-toolbar {`), /#bdcbdc|#597498/);
  });

  test(`${era}: alerts are flat boxes with hairline-split tinted buttons, the preferred one semibold`, () => {
    const box = decls(css, `html[data-style="${era}"] .alert {`);
    assert.match(box, /border:\s*0/);
    assert.match(box, /box-shadow:\s*none/);
    assert.match(box, /text-shadow:\s*none/);
    const btn = decls(css, `html[data-style="${era}"] .alert-button:disabled {`);
    assert.match(btn, /background:\s*none/);
    assert.match(btn, new RegExp(`color:\\s*var\\(${tint}\\)`));
    for (const kind of ["cancel", "green", "red", "blue"]) assert.ok(css.includes(`html[data-style="${era}"] .alert-button.${kind},`), `${kind} flat too`);
    assert.match(decls(css, `html[data-style="${era}"] .alert-button:last-child:not(.cancel)`), /font-weight:\s*600/);
    assert.match(css, new RegExp(`html\\[data-style="${era}"\\] \\{\\s*--alert-w: 270px`));
  });
}

test("iOS 13's alert is a 14pt box over a blur, white or #1c1c1e, with a rounded field", () => {
  const css = sheets.ios13;
  const box = decls(css, 'html[data-style="ios13"] .alert {');
  assert.match(box, /border-radius:\s*14px/);
  assert.match(box, /backdrop-filter:\s*blur\(/);
  assert.match(decls(css, 'html[data-style="ios13"][data-theme="light"] {\n  --i13-alert:'), /--i13-alert:\s*rgba\(255,255,255,/);
  assert.match(decls(css, 'html[data-style="ios13"][data-theme="dark"] {\n  --i13-alert:'), /--i13-alert:\s*rgba\(28,28,30,/);
  assert.match(decls(css, 'html[data-style="ios13"] .alert-field {'), /border-radius:\s*7px/);
});
