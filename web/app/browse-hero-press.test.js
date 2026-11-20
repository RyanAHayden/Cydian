// The Tweak/App of the Day card goes down under the finger like the iOS 6 App Store's banner: app.js marks it
// .is-pressed (PRESSABLE, with the 140 ms quick-tap hold and the scroll cancel every pressable gets) and
// packages.css darkens the whole card with a veil above its children.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const css = strip(readFileSync(new URL("./packages.css", import.meta.url), "utf8"));
// Every rule of the selector together (C46: a rule's layout and its look-only half are two rules).
const rule = (sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, s]) => s.trim() === sel).map((m) => m[2]).join(";");

test("the loaded card (a link) is pressable; the loading placeholder is not", () => {
  const list = /const PRESSABLE = "([^"]+)"/.exec(app)[1].split(",").map((s) => s.trim());
  assert.ok(list.includes("a.browse-hero"), list.join(", "));
  assert.ok(!list.includes(".browse-hero"), "the div placeholder must not press");
});

test("held, a dark veil covers the whole card, above the icon, without catching taps", () => {
  const veil = rule(".browse-hero::after");
  assert.match(veil, /position:\s*absolute/);
  assert.match(veil, /inset:\s*0/);
  assert.match(veil, /z-index:\s*[1-9]/);
  assert.match(veil, /pointer-events:\s*none/);
  assert.match(veil, /background:\s*rgba\(0,\s*0,\s*0,\s*\.3\)/);
  assert.match(veil, /opacity:\s*0/);
  assert.match(rule(".browse-hero.is-pressed::after"), /opacity:\s*1/);
  assert.doesNotMatch(veil + rule(".browse-hero.is-pressed::after"), /box-shadow|glow|255,\s*255,\s*255/);
  const card = rule(".browse-hero");
  assert.match(card, /position:\s*relative/);
  assert.match(card, /overflow:\s*hidden/, "the card's radius clips the veil");
});
