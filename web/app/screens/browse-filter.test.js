// F154: Browse's title drop-down (Featured / New / Top 25) and the routes below Browse (Roulette, All Categories,
// Collections).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browsePage, nav, BROWSE_SUBTITLE } from "./home.js";
import { BROWSE_FILTERS, browseFilter, browseFilterNow, chooseFilter, setBrowseFilter, filterView, TOP_LIMIT } from "./browse.js";

test("the drop-down offers Featured, New and Top 25; the choice sticks and unknown ones mean Featured", async () => {
  assert.deepEqual(BROWSE_FILTERS.map((f) => f.label), ["Featured", "New", "Top 25"]);
  assert.equal(browseFilter("nope").id, "featured");
  assert.equal(browseFilterNow(), "featured", "Browse opens on Featured");
  let asked = null;
  const sheet = async (opts) => { asked = opts; return 2; };
  assert.equal(await chooseFilter({ sheet }), 2);
  assert.deepEqual(asked.buttons, ["Featured", "New", "Top 25"], "an action sheet of the three");
  assert.equal(browseFilterNow(), "top");
  assert.equal(await chooseFilter({ sheet: async () => -1 }), -1);
  assert.equal(browseFilterNow(), "top", "Cancel keeps the choice");
  assert.equal(setBrowseFilter("new"), "new");
  assert.equal(setBrowseFilter("bogus"), "featured");
});

test("each choice's rows: New is F124's New list, Top 25 is Popular ranked and cut at 25", async () => {
  const calls = [];
  const deps = {
    fresh: async (kind) => { calls.push(["fresh", kind]); return [{ id: "n" }]; },
    popular: async (opts) => { calls.push(["popular", opts]); return Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` })); },
  };
  const n = filterView("new", deps);
  assert.deepEqual(await n.rows(), [{ id: "n" }]);
  assert.equal(n.ranked, false);
  const t = filterView("top", deps);
  const top = await t.rows();
  assert.equal(TOP_LIMIT, 25);
  assert.equal(top.length, 25);
  assert.equal(top[0].id, "p0", "in Popular's order");
  assert.equal(t.ranked, true);
  assert.deepEqual(calls, [["fresh", "new"], ["popular", { limit: 25 }]]);
  assert.equal(filterView("featured", deps).rows, undefined, "Featured draws its own page");
});

test("routes below Browse: Roulette, All Categories, a collection; the root's title is Browse with the drop-down", () => {
  assert.deepEqual(browsePage(["browse"]), { page: "root" });
  assert.deepEqual(browsePage(["browse", "roulette"]), { page: "roulette" });
  assert.deepEqual(browsePage(["browse", "categories"]), { page: "categories" });
  assert.deepEqual(browsePage(["browse", "collection:lock-screen"]), { page: "collection", value: "lock-screen" });
  assert.deepEqual(browsePage(["browse", "collection:nope"]), { page: "browse" }, "an unknown collection: Not Found");
  assert.deepEqual(browsePage(["browse", "roulette", "package:com.x"]), { page: "browse" }, "Roulette's View: a package page");
  assert.deepEqual(browsePage(["browse", "new"]), { page: "list", value: "new" }, "F124's list routes stay for links");
  const root = nav({ tab: "home", path: ["browse"] });
  assert.equal(root.title, "Browse", "the back button above it reads Browse");
  assert.equal(nav({ tab: "home", path: ["browse", "roulette"] }).title, "Roulette");
  assert.equal(nav({ tab: "home", path: ["browse", "categories"] }).title, "All Categories");
  assert.equal(nav({ tab: "home", path: ["browse", "collection:make-it-yours"] }).title, "Make It Yours");
  assert.equal(nav({ tab: "home", path: ["browse", "roulette", "package:com.x"] }).right.label, "Install");
  assert.match(BROWSE_SUBTITLE, /New/);
});

test("no segmented control on Browse: the title is the drop-down button, and its CSS is there", () => {
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const part = src.slice(src.indexOf("// ---- Browse (F154)"));
  assert.match(part, /titleView: globalThis\.document \? filterButton\(\)/);
  assert.doesNotMatch(part, /segment/i);
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  for (const cls of [".browse-filter", ".browse-hero", ".roulette-picker", ".roulette-band", ".roulette-spin"]) assert.ok(css.includes(cls), cls);
  for (const icon of ["Widgets", "Tweaks", "Keyboards", "Wallpaper", "Toys", "Themes", "Utilities", "Games", "Multimedia", "Social", "Entertainment"]) {
    assert.doesNotThrow(() => readFileSync(new URL(`../icons/sections/${icon}.png`, import.meta.url)), icon);
  }
  assert.doesNotThrow(() => readFileSync(new URL("../icons/roulette.svg", import.meta.url)));
});
