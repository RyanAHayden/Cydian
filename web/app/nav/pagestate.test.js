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

// B148: a kept page shown again refreshes its state-made texts in place.
import { liveText, refreshLive, pageShown, onPageShow, patchDetails } from "./pagestate.js";

test("liveText: filled now, again on its page's show, an older answer never paints over a newer one", async () => {
  const page = { contains: (n) => n === node };
  const node = { textContent: "", isConnected: true };
  const answers = [];
  liveText(node, () => new Promise((r) => answers.push(r)));
  answers[0]("Off");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(node.textContent, "Off");
  const shown = pageShown({ tab: "settings", path: [] }, page);
  const again = refreshLive(page);
  answers[2]("On"); // the newer read lands first
  answers[1]("Off");
  await Promise.all([shown, again]);
  assert.equal(node.textContent, "On");
});

test("onPageShow runs only for the pages it picks; a node taken off its page is forgotten", async () => {
  const seen = [];
  const off = onPageShow((r) => r.path[0] === "x", (r) => seen.push(r.path.join("/")));
  await pageShown({ tab: "a", path: ["x"] }, null);
  await pageShown({ tab: "a", path: ["y"] }, null);
  off();
  await pageShown({ tab: "a", path: ["x"] }, null);
  assert.deepEqual(seen, ["x"]);
  let runs = 0;
  const node = { textContent: "", isConnected: true };
  liveText(node, () => { runs++; return "v"; });
  const page = { contains: (n) => n === node }; // its own page: other tests' live texts stay out of it
  await refreshLive(page);
  node.isConnected = false;
  await refreshLive(page);
  await refreshLive(page);
  assert.equal(runs, 2, "ran at start and once more while on the page");
});

test("patchDetails: by label, in place; rows without a match or a detail stay", () => {
  const a = { textContent: "Not Paired" }, b = { textContent: "Off" };
  const cells = [{ label: "Pairing", detail: a }, { label: "VPN", detail: b }, { label: "Open", detail: null }];
  assert.equal(patchDetails(cells, [{ label: "Pairing", detail: "Paired" }, { label: "Open", detail: "x" }, { label: "New", detail: "y" }]), 1);
  assert.equal(a.textContent, "Paired");
  assert.equal(b.textContent, "Off");
});
