// Every frontend module must parse. A module that throws a SyntaxError on load (a duplicate binding such as an
// imported name declared again with const) leaves the page on its Loading screen, and the unit tests never see it
// because they import the modules they test, not app.js. `node --check` parses each file as the browser would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function modules(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor" && e.name !== "node_modules") out.push(...modules(p)); }
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(p);
  }
  return out;
}

test("app.js and every module under web/app parse (node --check)", () => {
  const files = modules(root);
  assert.ok(files.includes(join(root, "app.js")));
  const bad = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
    catch (e) { bad.push(`${f.slice(root.length + 1)}: ${String(e.stderr).trim().split("\n").find((l) => l.includes("Error")) ?? e.message}`); }
  }
  assert.deepEqual(bad, []);
});
