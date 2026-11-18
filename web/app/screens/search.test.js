import { test } from "node:test";
import assert from "node:assert/strict";
import { SCOPES, scopesFor, searchFilters, scopeIndex, sheetActive } from "./search.js";

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

test("F41: Not Jailbroken hides the Tweaks and Themes segments", () => {
  assert.deepEqual(scopesFor("none"), ["All", "Apps"]);
  assert.deepEqual(scopesFor("iphoneos-arm64"), SCOPES);
  assert.deepEqual(scopesFor("iphoneos-arm"), SCOPES);
});

test("F53: the Filter panel's Source rows follow the device type, by the Sources tab's names", async () => {
  const { sourceChoices } = await import("./search.js");
  const list = [
    { key: "apt:bigboss", uri: "http://apt.thebigboss.org/repofiles/cydia/", name: "BigBoss" },
    { key: "apt:chariz", uri: "https://repo.chariz.com/", origin: "Chariz" },
    { key: "alt:https://alt.crystall1ne.dev/", uri: "https://alt.crystall1ne.dev/", name: "crystall1ne.dev" },
    { key: "alt:https://raw.githubusercontent.com/chachillie/flycast/main/source.json",
      uri: "https://raw.githubusercontent.com/chachillie/flycast/main/source.json", name: "Flycast-iOS26" },
  ];
  const none = sourceChoices(list, "none");
  assert.deepEqual(none.map((o) => o.label), ["crystall1ne.dev", "Flycast-iOS26"], "Not Jailbroken: AltStore sources only, by name");
  assert.ok(none.every((o) => o.value.startsWith("alt:")));
  for (const type of ["iphoneos-arm64", "iphoneos-arm"]) {
    assert.deepEqual(sourceChoices(list, type).map((o) => o.label), ["BigBoss", "Chariz", "crystall1ne.dev", "Flycast-iOS26"], type);
  }
  assert.deepEqual(sourceChoices(list, "iphoneos-arm64", ["alt:https://alt.crystall1ne.dev/", "apt:chariz"]).map((o) => o.value)[0],
    "alt:https://alt.crystall1ne.dev/", "Manage > Sources' order");
  // Not loaded yet: the same fallback as the Sources tab (host, or GitHub user).
  assert.deepEqual(sourceChoices([{ key: "alt:https://alt.x.dev/a.json", uri: "https://alt.x.dev/a.json" }], "none").map((o) => o.label), ["alt.x.dev"]);
  assert.deepEqual(sourceChoices(null, "none"), []);
});

test("F100: Recent Searches: last 5, newest first, no duplicates, cleared, stored through core/settings.js", async () => {
  const { addRecent, RECENT_MAX, createSettings } = await import("../core/settings.js");
  const { recentRows } = await import("./search.js");
  assert.equal(RECENT_MAX, 5);
  assert.deepEqual(addRecent([], "  snowboard "), ["snowboard"], "trimmed");
  assert.deepEqual(addRecent(["a", "b"], ""), ["a", "b"], "an empty query saves nothing");
  assert.deepEqual(addRecent(["a", "Snowboard", "b"], "snowboard"), ["snowboard", "a", "b"], "a repeat moves to the top, once");
  assert.deepEqual(addRecent(["1", "2", "3", "4", "5"], "6"), ["6", "1", "2", "3", "4"], "only the last five");
  assert.deepEqual(addRecent("junk", "x"), ["x"], "a hand-edited value never breaks it");

  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const s = createSettings({ storage, mode: "site" });
  const heard = [];
  s.onChange((key, value) => heard.push([key, value]));
  assert.deepEqual(s.recentSearches.list(), []);
  for (const q of ["filza", "snowboard", "filza"]) s.recentSearches.add(q);
  assert.deepEqual(s.recentSearches.list(), ["filza", "snowboard"]);
  assert.equal(mem.get("cydian.recentSearches"), JSON.stringify(["filza", "snowboard"]), "kept under cydian.recentSearches");
  assert.deepEqual(createSettings({ storage, mode: "site" }).recentSearches.list(), ["filza", "snowboard"], "survives a reload");
  heard.length = 0;
  s.recentSearches.add("filza");
  assert.deepEqual(heard, [], "no change, no notification");
  s.recentSearches.clear();
  assert.deepEqual(s.recentSearches.list(), []);
  assert.deepEqual(heard, [["recentSearches", []]]);
  mem.set("cydian.recentSearches", "{not json");
  assert.deepEqual(s.recentSearches.list(), []);

  const picked = [];
  const rows = recentRows(["filza", "snowboard"], (q) => picked.push(q));
  assert.deepEqual(rows.map((r) => r.label), ["filza", "snowboard"]);
  rows[1].onClick();
  assert.deepEqual(picked, ["snowboard"], "a tap runs that query again");
  assert.deepEqual(recentRows(null, () => {}), []);
});
