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
