// B4: short pages rubber-band through a zero-width float in .page-body (ios6.css), never by stretching a child.
// dca99b5's `.page-body > :first-child { min-height: calc(100% + 1px) }` stretched the first group of every page
// that appends several groups straight into .page-body (Settings root, the package page), pushing the rest down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./ios6.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const base = readFileSync(new URL("./style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const zOf = (src, sel) => Number(new RegExp(`(^|\\n)${sel.replace(/\./g, "\\.")}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(src)?.[2]);

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

// F204 (replaces B25/B26's push): top notices stop moving the page. Nothing moves the nav bar, the screens or the
// sheets for a banner or the reload bar any more.
test("no banner or reload-bar rule moves the nav bar, the screens or the sheets", () => {
  assert.doesNotMatch(css, /has-banner|--banner-h/, "html.has-banner is gone");
  for (const { sel, decl } of rules) {
    if (/#navbar|#screens|\.sheet\b(?!-)/.test(sel) && /has-reload|has-banner/.test(sel)) assert.fail(`${sel} still moves`);
    if (/^\.sheet$/.test(sel)) assert.doesNotMatch(decl, /translate/, ".sheet keeps no translate transition");
  }
});

// The banner sits right under the nav bar (top = --nav-h), below it in z-order and above the screens, so it slides
// out from behind the nav bar; it has no safe-area top padding of its own. Inside a sheet (banner.js) the same
// z-index puts it under the sheet's nav bar (a .navbar, z-index 3) and over its body.
test("the banner sits under the nav bar, below it in z-order, without the safe-area padding", () => {
  const b = rules.find((x) => x.sel === ".banner");
  assert.ok(b, ".banner missing");
  assert.match(b.decl, /top\s*:\s*var\(--nav-h\)/);
  assert.doesNotMatch(b.decl, /safe-area-inset-top/);
  const z = zOf(css, ".banner");
  assert.ok(z < zOf(base, ".navbar"), "below the nav bar");
  assert.ok(z > zOf(base, "#screens"), "over the page");
  const t = rules.find((x) => x.sel === ".banner-timer");
  assert.ok(t, "the timer line");
  assert.match(t.decl, /height\s*:\s*2px/);
  assert.match(t.decl, /bottom\s*:\s*0/);
  assert.match(t.decl, /transform-origin\s*:\s*left/);
});

// B40 (checked on the iPhone 7, 0.9.7, ref/7/screens/b40-*.png): the reload bar shows whole, right on top of the tab
// bar, and the last row scrolls clear of both. The geometry that makes it so: the strip's bottom edge is the tab bar's
// top (both from --tab-h), it paints over the screens and under the tab bar, the scrollers' end room while it shows is
// at least the strip's height, and over a sheet (no tab bar) it drops by exactly the tab bar's 49 pt, onto the home
// indicator's inset, never below the screen.
test("B40: the reload bar sits whole right above the tab bar, and the last row can scroll clear of it", () => {
  const bar = rules.find((x) => x.sel === ".reload-bar");
  assert.ok(bar, ".reload-bar missing");
  assert.match(bar.decl, /position\s*:\s*fixed/);
  assert.match(bar.decl, /bottom\s*:\s*var\(--tab-h\)/, "its bottom edge is the tab bar's top");
  const h = Number(/(?:^|;)\s*height\s*:\s*(\d+)px/.exec(bar.decl)?.[1]);
  assert.equal(h, 44);
  assert.doesNotMatch(bar.decl, /(?:^|;)\s*(transform|translate|margin-bottom)\s*:/, "nothing shifts it off the tab bar when idle");
  const tab = new RegExp(String.raw`(^|\n)\.tabbar\s*\{([^}]*)\}`).exec(base)?.[2] ?? "";
  assert.match(tab, /bottom\s*:\s*0/);
  assert.match(tab, /height\s*:\s*var\(--tab-h\)/, "the tab bar is exactly --tab-h tall");
  assert.match(base, /--tab-h\s*:\s*calc\(49px \+ env\(safe-area-inset-bottom\)\)/);
  const z = zOf(css, ".reload-bar");
  assert.ok(z > zOf(base, "#screens"), "over the page, not behind it");
  assert.ok(z < zOf(base, ".tabbar"), "under the tab bar, so it slides out from behind it");
  const room = rules.find((x) => /^html\.has-reload :is\([^)]*\.page-body[^)]*\)::after$/.test(x.sel));
  assert.ok(room, "the scrollers get room at their end while it shows");
  assert.ok(Number(/height\s*:\s*(\d+)px/.exec(room.decl)?.[1]) >= h, "at least the strip's height");
  assert.match(room.decl, /display\s*:\s*block/);
  assert.match(room.decl, /clear\s*:\s*both/, "below the rubber-band float, not beside it");
  const over = rules.find((x) => x.sel === "body:has(.sheet) .reload-bar");
  assert.ok(over, "over a sheet");
  assert.match(over.decl, /translate\s*:\s*0 calc\(var\(--tab-h\) - env\(safe-area-inset-bottom\)\)/, "down by the tab bar's 49 pt only");
});
