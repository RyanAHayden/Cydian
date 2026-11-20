// Regex lookbehind is a SyntaxError before Safari 16.4: one in any shipped module stops every module that imports
// it from loading, and the app hangs on Loading on iOS 15 (iPhone 7). Tests run in node and may use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const LOOKBEHIND = ["(?<" + "=", "(?<" + "!"];

function shipped(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) shipped(p, out);
    else if (/\.(m?js|html)$/.test(e.name) && !/\.test\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

test("no regex lookbehind in shipped web/app code", () => {
  const files = shipped(ROOT);
  assert.ok(files.some((f) => f.endsWith(join("core", "tweaks.js"))), "walk found the app's modules");
  const hits = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (LOOKBEHIND.some((s) => line.includes(s))) hits.push(`${relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], "lookbehind breaks iOS 15 (Safari < 16.4); match the word, then test the one before it");
});
