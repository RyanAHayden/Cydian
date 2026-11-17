// F46: Home's Browse routes and its page's groups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { browsePage, browseGroups, nav } from "./home.js";

test("Browse routes: the list, Popular, a category, and browse.js pages below them", () => {
  assert.deepEqual(browsePage(["browse"]), { page: "root" });
  assert.deepEqual(browsePage(["browse", "popular"]), { page: "popular" });
  assert.deepEqual(browsePage(["browse", "category:Photo & Video"]), { page: "category", value: "Photo & Video" });
  assert.deepEqual(browsePage(["browse", "category:Games", "package:com.x"]), { page: "browse" });
  assert.equal(nav({ tab: "home", path: ["browse"] }).title, "Browse");
  assert.equal(nav({ tab: "home", path: ["browse", "popular"] }).title, "Popular");
  assert.equal(nav({ tab: "home", path: ["browse", "category:Games"] }).title, "Games");
  assert.equal(nav({ tab: "home", path: ["browse", "popular", "package:com.x"] }).right.label, "Install", "a package page, as in Search");
});

test("Browse page: Popular first, then each category with its count, linking below browse/", () => {
  const [popular, cats] = browseGroups([{ name: "Games", count: 3 }, { name: "Photo & Video", count: 1 }]);
  assert.equal(popular.rows[0].label, "Popular");
  assert.equal(popular.rows[0].href, "#/home/browse/popular");
  assert.equal(cats.header, "Categories");
  assert.deepEqual(cats.rows.map((r) => [r.label, r.detail]), [["Games", "3"], ["Photo & Video", "1"]]);
  assert.equal(cats.rows[1].href, "#/home/browse/category%3APhoto%20%26%20Video");
  assert.equal(browseGroups([]).length, 2, "no sources: Popular and a hint");
});
