// B4: short pages rubber-band through a zero-width float in .page-body (ios6.css), never by stretching a child.
// dca99b5's `.page-body > :first-child { min-height: calc(100% + 1px) }` stretched the first group of every page
// that appends several groups straight into .page-body (Settings root, the package page), pushing the rest down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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
  assert.match(base, /--tab-h\s*:\s*calc\(49px \+ var\(--safe-bottom\)\)/);
  const z = zOf(css, ".reload-bar");
  assert.ok(z > zOf(base, "#screens"), "over the page, not behind it");
  assert.ok(z < zOf(base, ".tabbar"), "under the tab bar, so it slides out from behind it");
  const room = rules.find((x) => /^html\.has-reload :is\([^)]*\.page-body[^)]*\)::after$/.test(x.sel));
  assert.ok(room, "the scrollers get room at their end while it shows");
  assert.ok(Number(/height\s*:\s*(\d+)px/.exec(room.decl)?.[1]) >= h, "at least the strip's height");
  assert.match(room.decl, /display\s*:\s*block/);
  assert.match(room.decl, /clear\s*:\s*both/, "below the rubber-band float, not beside it");
});

// B154: a modal sheet covers the reload bar, as on iOS 6: no rule lifts the strip over a sheet, and its z-index stays
// under the sheets' and the dark action sheets' scrim, so it shows again when the sheet closes.
test("B154: modal sheets cover the reload bar", () => {
  const pk = readFileSync(new URL("./packages.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const z = zOf(css, ".reload-bar");
  assert.ok(z < zOf(pk, ".sheet"), "under the modal sheets");
  assert.ok(z < zOf(pk, ".action-scrim"), "under the action sheets");
  for (const r of rules.filter((x) => /reload-bar/.test(x.sel) && x.sel !== ".reload-bar")) {
    assert.doesNotMatch(r.decl, /z-index/, `${r.sel} must not lift the strip`);
  }
  assert.ok(!rules.some((x) => /\.sheet\b[^,{]*\.reload-bar/.test(x.sel)), "no rule moves the strip onto a sheet");
});

// B191: 120 Hz (AGENTS.md): only transform and opacity animate. No `transition` in any web/app stylesheet names a
// layout property (or leaves the property out, which means `all`); a size change slides with a transform instead
// (nav/slide.js, or a counter-transform as on sources.css's rows).
const LAYOUT = /^(all|width|height|(min|max)-(width|height)|inline-size|block-size|(min|max)-(inline|block)-size|margin(-[a-z]+)*|padding(-[a-z]+)*|top|right|bottom|left|inset(-[a-z]+)*|border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?|flex(-[a-z]+)*|(row-|column-)?gap|grid(-[a-z]+)*|font|font-size|line-height|letter-spacing|word-spacing|text-indent|vertical-align)$/;
const EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete|initial|inherit|unset)$/;
const splitTop = (s) => { // on commas outside parentheses (cubic-bezier(...))
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
};
export function transitionedProps(src) {
  const props = [];
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, value] of text.matchAll(/(?:^|[;{\s])(transition(?:-property)?)\s*:\s*([^;}]*)/g)) {
    for (const item of splitTop(value.replace(/!important/, ""))) {
      if (name === "transition-property") { props.push(item); continue; }
      const words = item.replace(/\([^)]*\)/g, "").split(/\s+/).filter((w) => /^-?[a-z][a-z-]*$/.test(w) && !EASING.test(w));
      if (words[0] === "none") continue;
      props.push(words[0] ?? "all");
    }
  }
  return props;
}

test("B191: no transition in web/app/*.css animates a layout property", () => {
  assert.deepEqual(transitionedProps(".a { transition: width .3s ease, opacity .2s; } .b{transition:.3s}"), ["width", "opacity", "all"]);
  assert.deepEqual(transitionedProps(".a { transition: transform .3s cubic-bezier(.25,.1,.25,1), opacity .3s linear; }"), ["transform", "opacity"]);
  assert.deepEqual(transitionedProps(".a { transition: none; transition-duration: 0s; transition-property: margin-left; }"), ["margin-left"]);
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.ok(files.length > 5, "the stylesheets are there");
  const bad = [];
  for (const f of files) {
    for (const p of transitionedProps(readFileSync(new URL(f, dir), "utf8"))) if (LAYOUT.test(p)) bad.push(`${f}: ${p}`);
  }
  assert.deepEqual(bad, [], "animate transform/opacity instead (nav/slide.js FLIP, or a counter-transform)");
});
