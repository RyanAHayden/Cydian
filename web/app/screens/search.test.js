import { test } from "node:test";
import assert from "node:assert/strict";
import { SCOPES, searchFilters, scopeIndex, sheetActive } from "./search.js";

test("F35: the scope bar's segments and what the catalog is asked", () => {
  assert.deepEqual(SCOPES, ["All", "Tweaks", "Themes", "Apps"]);
  assert.equal(searchFilters({ section: null, source: null, installed: null, price: null }), undefined, "no filters: the plain search");
  assert.deepEqual(searchFilters({ section: "group:Themes", source: null, installed: "not", price: "" }), { section: "group:Themes", installed: "not" });
  assert.equal(scopeIndex(null), 0);
  assert.equal(scopeIndex("group:Tweaks"), 1);
  assert.equal(scopeIndex("group:Apps"), 3);
  assert.equal(scopeIndex("group:Utilities"), -1, "a group only the sheet offers selects no segment");
  assert.equal(scopeIndex("Tweaks"), -1, "a section picked in the sheet selects no segment");
  assert.equal(sheetActive({ section: "group:Themes" }), false);
  assert.equal(sheetActive({ section: "Addons" }), true);
  assert.equal(sheetActive({ price: "paid" }), true);
});
