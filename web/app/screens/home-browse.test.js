// F46: Home's Browse routes and its page's groups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { browsePage, browseGroups, nav, dayHeaders, BROWSE_SUBTITLE } from "./home.js";

test("Browse routes: the list, Popular, a category, and browse.js pages below them", () => {
  assert.deepEqual(browsePage(["browse"]), { page: "root" });
  assert.deepEqual(browsePage(["browse", "popular"]), { page: "list", value: "popular" });
  for (const id of ["new", "updated", "featured", "free-apps", "free-tweaks", "free-themes"]) assert.deepEqual(browsePage(["browse", id]), { page: "list", value: id });
  assert.deepEqual(browsePage(["browse", "nonsense"]), { page: "browse" }, "not a list: browse.js says Not Found");
  assert.deepEqual(browsePage(["browse", "category:Photo & Video"]), { page: "category", value: "Photo & Video" });
  assert.deepEqual(browsePage(["browse", "category:Games", "package:com.x"]), { page: "browse" });
  assert.equal(nav({ tab: "home", path: ["browse"] }).title, "Browse");
  assert.equal(nav({ tab: "home", path: ["browse", "popular"] }).title, "Popular");
  assert.equal(nav({ tab: "home", path: ["browse", "new"] }).title, "New");
  assert.equal(nav({ tab: "home", path: ["browse", "updated"] }).title, "Recently Updated");
  assert.equal(nav({ tab: "home", path: ["browse", "free-apps"] }).style, "plain");
  assert.equal(nav({ tab: "home", path: ["browse", "category:Games"] }).title, "Games");
  assert.equal(nav({ tab: "home", path: ["browse", "popular", "package:com.x"] }).right.label, "Install", "a package page, as in Search");
});

test("Browse page (F124): the lists in Cydia's order, then each category with its count, linking below browse/", () => {
  const [lists, cats] = browseGroups([{ name: "Games", count: 3 }, { name: "Photo & Video", count: 1 }]);
  assert.deepEqual(lists.rows.map((r) => r.label), ["New", "Recently Updated", "Popular", "Featured", "Free Apps", "Free Tweaks", "Free Themes"]);
  assert.deepEqual(lists.rows.map((r) => r.href), ["new", "updated", "popular", "featured", "free-apps", "free-tweaks", "free-themes"].map((id) => `#/home/browse/${id}`));
  assert.equal(cats.header, "Categories");
  assert.deepEqual(cats.rows.map((r) => [r.label, r.detail]), [["Games", "3"], ["Photo & Video", "1"]]);
  assert.equal(cats.rows[1].href, "#/home/browse/category%3APhoto%20%26%20Video");
  assert.equal(browseGroups([]).length, 2, "no sources: the lists and a hint");
  assert.match(browseGroups([])[1].footer, /Add a source/);
  // Not Jailbroken: no Free Tweaks or Free Themes
  assert.deepEqual(browseGroups([], { jailbroken: false })[0].rows.map((r) => r.label), ["New", "Recently Updated", "Popular", "Featured", "Free Apps"]);
  assert.match(BROWSE_SUBTITLE, /New/);
});

test("dayHeaders: New and Recently Updated get a header per day, newest first as given", () => {
  const now = new Date(2026, 10, 18, 15).getTime();
  const at = (d, h) => new Date(2026, 10, d, h).getTime();
  const items = dayHeaders([{ id: "a", seen: at(18, 9) }, { id: "b", seen: at(18, 1) }, { id: "c", seen: at(17, 20) }, { id: "d", seen: at(12, 8) }], now);
  assert.deepEqual(items.map((i) => i.header ?? i.id).slice(0, 5), ["Today", "a", "b", "Yesterday", "c"]);
  assert.equal(items.length, 7);
  assert.ok(items[5].header && !/Today|Yesterday/.test(items[5].header));
  assert.deepEqual(dayHeaders([]), []);
});
