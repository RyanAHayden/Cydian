// F166: the spinners turn in the app (no steps() timing, no native-only rule stopping them) and are drawn from the
// 4S's UIActivityIndicatorView frames.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SPINNERS, spinnerSVG, spinnerURL } from "./spinner.js";

const dir = new URL("../", import.meta.url);
const sheets = readdirSync(dir).filter((f) => f.endsWith(".css"))
  .map((f) => ({ f, css: readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

// Flat list of { sel, body, at } for every rule, @media blocks unwrapped (at = the @media prelude or "").
function rules(css) {
  const out = [];
  let i = 0;
  const walk = (end, at) => {
    while (i < end) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= end) { i = end; return; }
      const sel = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < css.length) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
      if (sel.startsWith("@media") || sel.startsWith("@supports")) { i = open + 1; walk(j - 1, sel); i = j; continue; }
      out.push({ sel, body: css.slice(open + 1, j - 1), at });
      i = j;
    }
  };
  walk(css.length, "");
  return out;
}
const all = sheets.flatMap(({ f, css }) => rules(css).map((r) => ({ ...r, f })));
const SPINNER_SEL = /hud-spinner|reload-spinner|loading-spinner|is-reloading|badge\.spinning|source-row\.is-loading/;

test("every spinner animation runs hud-spin at 0.96 s with linear timing, never steps()", () => {
  const users = all.filter((r) => /animation:\s*hud-spin/.test(r.body));
  assert.ok(users.length >= 6, `found ${users.length} hud-spin users`);
  for (const r of users) assert.match(r.body, /animation:\s*hud-spin \.96s linear infinite/, `${r.f}: ${r.sel}`);
  for (const r of all) assert.doesNotMatch(r.body, /hud-spin[^;]*steps\(/, `${r.f}: ${r.sel}`);
});

test("@keyframes hud-spin holds each 30-degree turn for 1/12 of the cycle", () => {
  const css = sheets.map((s) => s.css).join("\n");
  const m = /@keyframes hud-spin \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, "no @keyframes hud-spin");
  assert.doesNotMatch(m[1], /:root|--spinner/, "the keyframes block swallowed the rule after it");
  const holds = [...m[1].matchAll(/([\d.]+)%, ([\d.]+)% \{ transform: rotate\((\d+)deg\); \}/g)]
    .map(([, a, b, d]) => [Number(a), Number(b), Number(d)]);
  assert.equal(holds.length, 12);
  holds.forEach(([a, b, d], k) => {
    assert.equal(d, k * 30);
    assert.ok(Math.abs(a - k * 100 / 12) < 0.01, `hold ${k} starts at ${a}%`);
    assert.ok(Math.abs(b - (k + 1) * 100 / 12) < 0.01, `hold ${k} ends at ${b}%`);
  });
});

test("no native-only or reduced-motion rule stops or hides a spinner", () => {
  for (const r of all) {
    const native = /\bnative\b/.test(r.sel);
    const spinner = SPINNER_SEL.test(r.sel);
    if (native) assert.doesNotMatch(r.body, /animation(-name|-play-state)?\s*:\s*(none|paused)|animation-play-state/, `${r.f}: ${r.sel}`);
    if (native && spinner) assert.doesNotMatch(r.body, /animation|transform|display:\s*none/, `${r.f}: ${r.sel}`);
    if (spinner && /reduced-motion/.test(r.at)) assert.doesNotMatch(r.body, /animation:\s*none|animation-name:\s*none|paused/, `${r.f}: ${r.sel}`);
  }
});

test("ios6.css carries nav/spinner.js's images, and every spinner uses one of them", () => {
  const ios6 = sheets.find((s) => s.f === "ios6.css").css;
  const root = rules(ios6).filter((r) => r.sel === ":root" && !r.at).map((r) => r.body).join("\n");
  for (const k of Object.keys(SPINNERS)) assert.ok(root.includes(`--spinner-${k}: ${spinnerURL(k)};`), `--spinner-${k} is missing from :root or stale: regenerate it from spinnerURL("${k}")`);
  const drawn = all.filter((r) => SPINNER_SEL.test(r.sel) && /animation:\s*hud-spin/.test(r.body));
  // the image may sit in the same selector's look-only rule (C46: packages.css splits layout from look)
  const paint = (r) => all.filter((x) => x.f === r.f && x.sel === r.sel && x.at === r.at).map((x) => x.body).join(";");
  for (const r of drawn) assert.match(paint(r), /background:\s*var\(--spinner-(white|gray|large)\)/, `${r.f}: ${r.sel}`);
});

test("the images have UIKit's geometry and alphas (measured from the 4S frames)", () => {
  const w = spinnerSVG("white");
  assert.equal((w.match(/<line /g) || []).length, 12);
  assert.match(w, /viewBox='0 0 20 20'/);
  assert.match(w, /stroke-width='2' stroke-linecap='round'/);
  assert.match(w, /<line x1='10' y1='1' x2='10' y2='4' opacity='0\.271'\/>/); // spoke 0: r 6..9 pt, the floor alpha
  assert.match(w, /rotate\(270 10 10\)' opacity='0\.851'/); // the brightest at 9 o'clock
  assert.match(spinnerSVG("large"), /viewBox='0 0 37 37'.*stroke-width='3'.*y1='2\.5' x2='18\.5' y2='8\.5'/);
  assert.match(spinnerSVG("gray"), /stroke='#000'.*rotate\(270 10 10\)' opacity='0\.384'/);
});
