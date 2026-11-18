// F154: Browse's Featured / New / Top 25 bar and the routes below Browse (Roulette, All Categories,
// Collections).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browsePage, nav, BROWSE_SUBTITLE } from "./home.js";
import { BROWSE_FILTERS, browseFilter, browseFilterNow, setBrowseFilter, filterView, TOP_LIMIT, heroTint, storeLabel } from "./browse.js";

test("the bar offers Featured, New and Top 25; the choice sticks and unknown ones mean Featured", () => {
  assert.deepEqual(BROWSE_FILTERS.map((f) => f.label), ["Featured", "New", "Top 25"]);
  assert.equal(browseFilter("nope").id, "featured");
  assert.equal(browseFilterNow(), "featured", "Browse opens on Featured");
  assert.equal(setBrowseFilter("top"), "top");
  assert.equal(browseFilterNow(), "top");
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

test("routes below Browse: Roulette, All Categories, a collection; the root's title is plain Browse", () => {
  assert.deepEqual(browsePage(["browse"]), { page: "root" });
  assert.deepEqual(browsePage(["browse", "roulette"]), { page: "roulette" });
  assert.deepEqual(browsePage(["browse", "categories"]), { page: "categories" });
  assert.deepEqual(browsePage(["browse", "collection:lock-screen"]), { page: "collection", value: "lock-screen" });
  assert.deepEqual(browsePage(["browse", "collection:nope"]), { page: "browse" }, "an unknown collection: Not Found");
  assert.deepEqual(browsePage(["browse", "roulette", "package:com.x"]), { page: "browse" }, "Roulette's View: a package page");
  assert.deepEqual(browsePage(["browse", "new"]), { page: "list", value: "new" }, "F124's list routes stay for links");
  const root = nav({ tab: "home", path: ["browse"] });
  assert.equal(root.title, "Browse", "the back button above it reads Browse");
  assert.equal(root.titleView, undefined, "no control in the title's place: it overlapped Back");
  assert.equal(nav({ tab: "home", path: ["browse", "roulette"] }).title, "Roulette");
  assert.equal(nav({ tab: "home", path: ["browse", "categories"] }).title, "All Categories");
  assert.equal(nav({ tab: "home", path: ["browse", "collection:make-it-yours"] }).title, "Make It Yours");
  assert.equal(nav({ tab: "home", path: ["browse", "roulette", "package:com.x"] }).right.label, "Install");
  assert.match(BROWSE_SUBTITLE, /New/);
});

test("Browse's choice is a segmented scope bar at the top of the page, not a title drop-down; its CSS is there", () => {
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const part = src.slice(src.indexOf("// ---- Browse (F154)"));
  assert.match(part, /el\("div", "search-scope browse-scope"\)/);
  assert.match(part, /body\.replaceChildren\(page\.bar\)/, "the bar stays when the page redraws");
  assert.doesNotMatch(part, /browse-filter|showActionSheet|titleView/);
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  for (const cls of [".browse-scope", ".browse-hero", ".roulette-picker", ".roulette-band", ".roulette-spin"]) assert.ok(css.includes(cls), cls);
  for (const icon of ["Widgets", "Tweaks", "Keyboards", "Wallpaper", "Toys", "Themes", "Utilities", "Games", "Multimedia", "Social", "Entertainment"]) {
    assert.doesNotThrow(() => readFileSync(new URL(`../icons/sections/${icon}.png`, import.meta.url)), icon);
  }
  assert.doesNotThrow(() => readFileSync(new URL("../icons/roulette.svg", import.meta.url)));
  assert.match(css, /\.browse-hero \{[^}]*var\(--hero-a/, "the banner takes the package's tint");
  assert.doesNotMatch(css, /browse-hero-view/, "no green View pill");
  assert.match(css, /a:active \.store-btn \{/, "pressing the card or cell presses the price button");
});

test("Tweak of the Day: a package keeps its banner tint; the price button says FREE or VIEW", () => {
  assert.deepEqual(heroTint("com.a.b"), heroTint("com.a.b"));
  assert.equal(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => heroTint(id)[0])).size > 1, true, "ids spread over the tints");
  assert.equal(storeLabel({ paid: false }), "FREE");
  assert.equal(storeLabel({ paid: true }), "VIEW");
});
