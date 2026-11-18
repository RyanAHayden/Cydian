// F158: Home's welcome is two lines, like Cydia's ("Welcome to Cydian" / "by ..."); the nod to Cydia lives in About.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("F158: Home has no 'inspired by' line, and About still credits Cydia", () => {
  const js = read("./home.js");
  const css = read("../home.css");
  assert.doesNotMatch(js, /home-nod/, "no nod paragraph on Home");
  assert.doesNotMatch(js, /inspired by/, "no lowercase 'inspired by' line on Home");
  assert.doesNotMatch(css, /home-nod/, "its CSS is gone too");
  // The welcome is still the title and the by-line.
  assert.match(js, /el\("h2", "home-title", "Welcome to Cydian"\)/);
  assert.match(js, /el\("p", "home-by", "by "\)/);
  // About keeps the credit and the note.
  const about = js.slice(js.indexOf("async function showAbout"), js.indexOf("// ---- Reload"));
  assert.match(about, /Inspired by Cydia\\nby Jay Freeman \(saurik\)/);
  assert.match(about, /Not affiliated with SaurikIT/);
});
