import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EASE, DURATION, SHEET_IN, loadStyle } from "./motion.js";

test("the iOS 6 curve and its durations", () => {
  assert.equal(EASE, "cubic-bezier(.25,.1,.25,1)");
  assert.equal(DURATION, 300);
  assert.equal(SHEET_IN, 350);
});

test("loadStyle links a web/app stylesheet once, and does nothing without a document", () => {
  loadStyle("none.css"); // no document in node: no throw
  const head = [];
  globalThis.document = { head: { append: (n) => head.push(n) }, createElement: () => ({}) };
  try {
    loadStyle("settings.css");
    loadStyle("settings.css");
    loadStyle("signsheet.css");
    assert.equal(head.length, 2);
    assert.equal(head[0].rel, "stylesheet");
    assert.ok(head[0].href.endsWith("/web/app/settings.css"), head[0].href);
  } finally { delete globalThis.document; }
});

test("the curve is typed out only in nav/motion.js among the app's modules", () => {
  const app = new URL("..", import.meta.url).pathname;
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "vendor" && name !== "node_modules") walk(p); continue; }
      if (!name.endsWith(".js") || name.endsWith(".test.js")) continue;
      if (readFileSync(p, "utf8").includes(EASE)) found.push(p.slice(app.length));
    }
  };
  walk(app);
  assert.deepEqual(found, ["nav/motion.js"]);
});
