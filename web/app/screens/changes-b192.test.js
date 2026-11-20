// B192: the jailbreak daemon installs automatically from https sources only; Changes says why on the rows it skips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsOf, autoHttpIds, AUTO_HTTP_NOTE } from "./changes.js";

const sources = [{ key: "plain", uri: "http://repo.ex.com/" }, { key: "safe", uri: "https://secure.ex.com/" }, { key: "odd" }];
const available = [
  { id: "tweak", key: "plain", version: "2", installed: "1", short: "A tweak" },
  { id: "lib", key: "safe", version: "3", installed: "2", short: "A library" },
  { id: "app", key: "plain", version: "4", installed: "3", remembered: true },
  { id: "nokey", version: "5", installed: "4" },
];

test("B192: Everything skips every http-sourced upgrade; https ones and remembered apps aren't flagged", () => {
  assert.deepEqual([...autoHttpIds(available, sources, { autoInstall: "all" })], ["tweak"]);
});

test("B192: Only Packages I Mark flags the marked ones; Off flags none", () => {
  assert.deepEqual([...autoHttpIds(available, sources, { autoInstall: "marked", marked: (id) => id === "lib" })], []);
  assert.deepEqual([...autoHttpIds(available, sources, { autoInstall: "marked", marked: (id) => id === "tweak" })], ["tweak"]);
  assert.deepEqual([...autoHttpIds(available, sources, { autoInstall: "off" })], []);
  assert.deepEqual([...autoHttpIds(available, null, { autoInstall: "all" })], []);
});

test("B192: a skipped row says why in place of its description, under Available Upgrades only", () => {
  const items = itemsOf([], "en-US", { available, ignored: [{ id: "tweak2", key: "plain", short: "Held" }] },
    { autoHttp: new Set(["tweak", "tweak2"]) });
  const byId = Object.fromEntries(items.filter((i) => i.id).map((i) => [i.id, i.short]));
  assert.equal(byId.tweak, AUTO_HTTP_NOTE);
  assert.equal(byId.lib, "A library");
  assert.equal(byId.tweak2, "Held");
  assert.match(AUTO_HTTP_NOTE, /http/);
  // without the set nothing changes
  assert.equal(itemsOf([], "en-US", { available, ignored: [] }).find((i) => i.id === "tweak").short, "A tweak");
});
