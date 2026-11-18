// B32: no alert can be widened by long text. Search's "Add this source?" alert (screens/search.js offer) carries the
// source's URL, one unbroken word; on the iPhone 7 (iOS 15 WebKit) the scrim's auto grid column grew to the text's
// unwrapped width, so the box was centred in a column wider than the screen and ran off its right edge. The column
// is now exactly the screen's width, the box stays inside it, and the title and message break long words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../sources.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const decl = (sel) => {
  const r = rules.find((x) => x.sel === sel);
  assert.ok(r, `${sel} missing from sources.css`);
  return r.decl;
};

test("the alert's column is the screen's width, not its text's", () => {
  assert.match(decl(".alert-scrim"), /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
});

test("the alert box never gets wider than the screen", () => {
  const d = decl(".alert");
  assert.match(d, /max-width\s*:\s*100%/);
  assert.match(d, /min-width\s*:\s*0/);
});

for (const sel of [".alert-message", ".alert-title"]) {
  test(`${sel} wraps long words`, () => {
    const d = decl(sel);
    assert.match(d, /overflow-wrap\s*:\s*anywhere/);
    assert.match(d, /word-break\s*:\s*break-word/); // for WebKit before overflow-wrap: anywhere (Safari 15.4)
    assert.doesNotMatch(d, /white-space\s*:\s*(nowrap|pre)\s*;/);
  });
}
