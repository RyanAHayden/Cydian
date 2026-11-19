// B43: a pushed page opens on its default; Back and tab switches keep what a page showed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onPageOpen, pageOpened } from "./pagestate.js";
import { createStacks } from "./stack.js";

test("pageOpened runs only the resets whose page is being built", () => {
  const ran = [];
  const off = onPageOpen((r) => r.tab === "a" && r.path[0] === "x", (r) => ran.push(r.path.join("/")));
  pageOpened({ tab: "a", path: ["x"] });
  pageOpened({ tab: "a", path: ["y"] });
  pageOpened({ tab: "b", path: ["x"] });
  assert.deepEqual(ran, ["x"]);
  off();
  pageOpened({ tab: "a", path: ["x"] });
  assert.deepEqual(ran, ["x"], "unregistered");
});

test("a matcher that throws resets nothing and stops no other reset", () => {
  let n = 0;
  const off1 = onPageOpen(() => { throw new Error("bad"); }, () => { n += 100; });
  const off2 = onPageOpen(() => true, () => { n += 1; });
  pageOpened({ tab: "a", path: [] });
  assert.equal(n, 1);
  off1();
  off2();
});

test("with the stacks: a push builds (resets), Back and a tab switch build nothing (keep)", () => {
  let mode = "default";
  const off = onPageOpen((r) => r.tab === "home" && r.path.join("/") === "browse", () => { mode = "default"; });
  const stacks = createStacks({ tabs: ["home", "installed"], create: (tab, path) => { pageOpened({ tab, path }); return {}; } });
  stacks.sync({ tab: "home", path: [] });
  stacks.sync({ tab: "home", path: ["browse"] });
  mode = "top";
  stacks.sync({ tab: "home", path: ["browse", "package:com.x"] });
  stacks.sync({ tab: "home", path: ["browse"] }); // Back
  assert.equal(mode, "top", "Back keeps the choice");
  stacks.sync({ tab: "installed", path: [] });
  stacks.sync({ tab: "home", path: ["browse"] }); // the tab again
  assert.equal(mode, "top", "a tab switch keeps it");
  stacks.sync({ tab: "home", path: [] });
  stacks.sync({ tab: "home", path: ["browse"] }); // pushed again
  assert.equal(mode, "default", "a push opens on the default");
  off();
});

test("app.js builds every page through pageOpened, before the screen's nav and render", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const make = src.slice(src.indexOf("function makePage"));
  const at = make.indexOf("pageOpened(route)");
  assert.ok(at > 0, "makePage calls pageOpened");
  assert.ok(at < make.indexOf("screen.nav(") && at < make.indexOf("screen.render("));
});
