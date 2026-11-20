// The tab bar's gloss is the kit's 49 pt bar from the top: split at the bar's own half (24.5 pt), never stretched
// over the strip above the home indicator (--safe-bottom), which would put the split through the icons. The strip
// is the base colour, equal to the gloss's last colour in every theme, so there is no seam where the gloss ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ios6 = read("./ios6.css");
const palettes = read("./palettes.css");

// Split a background value into its comma-separated layers (commas inside parentheses don't split).
function layers(value) {
  const out = []; let depth = 0, cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const lastStop = (grad) => {
  const inner = /^linear-gradient\((.*)\)/.exec(grad)[1];
  return layers(inner).at(-1).split(/\s+/)[0];
};

const backgrounds = [];
const base = /(^|\n)\.tabbar\s*\{[^}]*background\s*:\s*([^;]+);/.exec(ios6)?.[2];
assert.ok(base, ".tabbar background missing");
backgrounds.push(["Classic .tabbar", base]);
for (const [name, src] of [["ios6.css", ios6], ["palettes.css", palettes]]) {
  for (const m of src.matchAll(/--dk-tabbar\s*:\s*([^;]+);/g)) backgrounds.push([`${name} --dk-tabbar #${backgrounds.length}`, m[1]]);
}

test("every tab bar background is found (Classic, OLED Black, Gunmetal, Midnight, Linen, Nord, Dracula, Leather, Felt, Wood)", () => {
  assert.equal(backgrounds.length, 10);
});

test("the gloss is 48 px tall from 1 px down, not sized by the bar's height", () => {
  for (const [name, bg] of backgrounds) {
    const ls = layers(bg.replace(/\s+/g, " "));
    const glosses = ls.filter((l) => l.startsWith("linear-gradient(") && !/\/ 100% 1px/.test(l));
    for (const g of glosses) {
      assert.match(g, /\) 0 1px \/ 100% 48px no-repeat$/, `${name}: ${g}`);
      assert.doesNotMatch(g, /\/ 100% (calc|\d+%)/, `${name}: the gloss must not stretch over the home-indicator strip`);
    }
  }
});

test("the base colour under the gloss is the gloss's last colour, so the strip continues it with no seam", () => {
  for (const [name, bg] of backgrounds) {
    const ls = layers(bg.replace(/\s+/g, " "));
    const fill = ls.at(-1);
    assert.match(fill, /^#[0-9a-f]{3,6}$/i, `${name}: ends in a flat colour`);
    for (const g of ls.filter((l) => l.startsWith("linear-gradient(") && !/\/ 100% 1px/.test(l))) {
      assert.equal(lastStop(g), fill, `${name}: gloss ends ${lastStop(g)}, strip is ${fill}`);
    }
  }
});
