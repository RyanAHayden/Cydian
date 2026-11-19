// F229: the website Home's two install rows read apart: green "Install <NAME> Lite" for any iPhone, and a pale
// lavender "Jailbroken? Install <NAME>" (no bright purple gradient, which drew the taps meant for the green row).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_ROW, appRowWords } from "./home.js";
import { NAME } from "../brand.js";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("green row: Lite, for any iPhone; the jailbroken .deb offer keeps its subtitle and drops Lite", () => {
  assert.deepEqual(APP_ROW, { label: `Install ${NAME} Lite`, subtitle: "For any iPhone · no jailbreak needed" });
  assert.deepEqual(appRowWords(null), APP_ROW);
  assert.deepEqual(appRowWords({ action: "sign" }), APP_ROW);
  assert.deepEqual(appRowWords({ action: "deb" }), { label: `Install ${NAME}`, subtitle: "The .deb for your jailbreak" });
});

test("purple row: 'Jailbroken?' as a lead span, then Install NAME, subtitle 'Tweaks, themes and apt'", () => {
  const home = src("./home.js");
  assert.match(home, /tile\(\{ lead: "Jailbroken\?", label: `Install \$\{NAME\}`, subtitle: "Tweaks, themes and apt"/);
  assert.match(home, /el\("span", "home-tile-lead", lead\)/);
  assert.doesNotMatch(home, /Install Full/);
});

test("home.css: the lavender tint, not the gradient; a dark value beside --tile-green's", () => {
  const css = src("../home.css");
  const purple = css.match(/\.home-row\.purple > \.table \{([^}]*)\}/)[1];
  assert.match(purple, /background: var\(--tile-purple\)/);
  assert.doesNotMatch(purple, /gradient/);
  assert.match(css, /--tile-purple: #f5f0ff; --tile-purple-edge: #a9a2b8; --tile-lead: #6a4fa0;/);
  assert.match(css, /html\[data-theme="dark"\] \.home \{ --tile-purple: var\(--dk-lavender\);/);
  // every dark palette names its own lavender, as it does --dk-green
  const palettes = src("../ios6.css") + src("../palettes.css");
  assert.equal(palettes.match(/--dk-lavender: #/g).length, palettes.match(/--dk-green: #/g).length);
  assert.equal(palettes.match(/--dk-lavender-text: #/g).length, palettes.match(/--dk-green: #/g).length);
  assert.match(css, /\.home-row\.purple \.home-tile \{ min-height: 58px; \}/);
  assert.match(css, /\.home-stack \.home-tile \{ min-height: 58px; \}/);
  assert.doesNotMatch(css, /\.home-row\.purple \.cell-label[^{]*\{[^}]*#fff/);
  assert.match(css, /\.home-tile-lead \{ color: var\(--tile-lead\); font-weight: normal; \}/);
  assert.match(css, /\.glyph-jailbreak \{[^}]*linear-gradient\(#8a5cd0, #5b2fa3\)/);
});
