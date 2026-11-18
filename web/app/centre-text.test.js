// F152: Home's welcome words are centred in the space beside the icon (as Cydia's Home), and a page whose only
// content is its empty-state note shows it in the middle of the page. Rendered checks: journal/2026-11-18-f152-centre-welcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rulesOf = (file) => {
  const css = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
};
// The value a property ends with for one exact selector, the last rule winning (as the cascade does in one file).
const last = (rules, sel, prop) => {
  let v;
  for (const r of rules.filter((x) => x.sel === sel)) {
    for (const m of r.decl.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))) v = m[1].trim();
  }
  return v;
};

test("Home's words sit in the middle of the space between the icon and the right edge", () => {
  const home = rulesOf("./home.css");
  assert.equal(last(home, ".home-head", "align-items"), "center", "centred down beside the icon");
  assert.equal(last(home, ".home-head", "gap"), "0", "a gap only on the icon's side would push the words off centre");
  assert.equal(last(home, ".home-head > .home-words", "margin"), "0 auto", "auto margins share the free space");
  const pad = last(home, ".home-head > .home-words", "padding")?.split(/\s+/);
  assert.ok(pad && pad.length === 2 && pad[1] !== "0", "equal left/right padding keeps the text off the icon");
  assert.notEqual(last(home, ".home-words", "text-align"), "center", "lines stay flush left inside the block, as Cydia's");
});

test("an empty-state note alone on a page is centred in it, like a loading page's spinner", () => {
  const style = rulesOf("./style.css");
  const sel = ".page-body > .empty:only-child";
  assert.equal(last(style, sel, "display"), "flex");
  assert.equal(last(style, sel, "align-items"), "center");
  assert.equal(last(style, sel, "justify-content"), "center");
  const loading = last(rulesOf("./packages.css"), ".page-body > .loading", "height");
  assert.equal(last(style, sel, "height"), loading, "the same height as the loading page's, so both sit at one spot");
  assert.equal(last(style, ".empty", "text-align"), "center");
});
