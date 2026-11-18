// B4: short pages rubber-band through a zero-width float in .page-body (ios6.css), never by stretching a child.
// dca99b5's `.page-body > :first-child { min-height: calc(100% + 1px) }` stretched the first group of every page
// that appends several groups straight into .page-body (Settings root, the package page), pushing the rest down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./ios6.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));

test("no rule sizes a page's children to the scroller's height", () => {
  for (const { sel, decl } of rules) {
    if (/\.page-body\s*>/.test(sel)) assert.doesNotMatch(decl, /(min-)?height\s*:[^;]*100%/, sel);
  }
});

test("the rubber-band spacer is a zero-width float 1px taller than the page", () => {
  const r = rules.find((x) => x.sel === ".page-body::before");
  assert.ok(r, ".page-body::before missing");
  assert.match(r.decl, /float\s*:\s*left/);
  assert.match(r.decl, /margin-right\s*:\s*-1px/);
  assert.match(r.decl, /height\s*:\s*calc\(100% \+ 1px\)/);
});

// B25: the banner covered the top of sheets (the install progress page's nav bar). The has-banner rule must move
// every .sheet down by --banner-h (by `translate`, which composes with the sheets' slide animations) and end it that
// much higher, and the banner must stay above the sheets.
test("while a banner shows, sheets move below it and end higher", () => {
  const r = rules.find((x) => /(^|,)\s*html\.has-banner \.sheet\s*(,|$)/.test(x.sel));
  assert.ok(r, "no html.has-banner .sheet rule");
  assert.match(r.decl, /translate\s*:\s*0 var\(--banner-h/);
  assert.match(r.decl, /bottom\s*:\s*var\(--banner-h/);
  const pk = readFileSync(new URL("./packages.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const z = (src, sel) => Number(new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(src)?.[2]);
  assert.ok(z(css, ".banner") > z(pk, ".sheet"), "the banner must sit above sheets");
});

// B26: the reload bar (z-index 49) covered a sheet's nav bar the same way. Sheets move down by its 44 pt under
// has-reload, and by banner + 44 pt under has-reload.has-banner, and the bar stays above the sheets.
test("while the reload bar shows, sheets move below it and end higher", () => {
  const find = (s) => rules.find((x) => x.sel.split(",").some((p) => p.trim() === s));
  const r = find("html.has-reload .sheet");
  assert.ok(r, "no html.has-reload .sheet rule");
  assert.match(r.decl, /translate\s*:\s*0 44px/);
  assert.match(r.decl, /bottom\s*:\s*44px/);
  const rb = find("html.has-reload.has-banner .sheet");
  assert.ok(rb, "no html.has-reload.has-banner .sheet rule");
  assert.match(rb.decl, /translate\s*:\s*0 calc\(var\(--banner-h, 44px\) \+ 44px\)/);
  assert.match(rb.decl, /bottom\s*:\s*calc\(var\(--banner-h, 44px\) \+ 44px\)/);
  const pk = readFileSync(new URL("./packages.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const z = (src, sel) => Number(new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(src)?.[2]);
  assert.ok(z(css, ".reload-bar") > z(pk, ".sheet"), "the reload bar must sit above sheets");
});
