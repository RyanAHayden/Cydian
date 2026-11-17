import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsOf, nav, scopeOf, emptyText } from "./changes.js";
import { pageOf, token } from "./browse.js";

test("Changes: a header per day, newest first, then its rows; package pages open below the tab", () => {
  const now = new Date(2026, 10, 17, 15).getTime();
  const day = (n) => new Date(2026, 10, 17 - n).getTime();
  const items = itemsOf([
    { day: day(0), rows: [{ id: "a", name: "A", change: "updated" }] },
    { day: day(1), rows: [{ id: "b", name: "B", change: "new" }, { id: "c", name: "C", change: "new" }] },
    { day: day(3), rows: [{ id: "d", name: "D", change: "new" }] },
  ], "en-US", undefined, { now });
  assert.deepEqual(items.map((i) => i.header ?? i.id), ["Today", "a", "Yesterday", "b", "c", "Saturday, November 14", "d"]);
  assert.equal(nav({ tab: "changes", path: [] }).left.label, "Refresh");
  assert.deepEqual(pageOf({ tab: "changes", path: [token("package", "a")] }), { key: "*", page: "package", value: "a" });
});

test("Changes: Available then Ignored Upgrades first; an upgraded package isn't listed again under New at", () => {
  const now = new Date(2026, 10, 17, 15).getTime();
  const items = itemsOf([{ day: new Date(2026, 10, 17).getTime(), rows: [{ id: "bash", name: "Bash", change: "updated" }, { id: "x", name: "X", change: "new" }] }],
    "en-US", { available: [{ id: "bash", name: "Bash", version: "2", installed: "1" }], ignored: [{ id: "wb", name: "WB", version: "3", installed: "2" }] }, { now });
  assert.deepEqual(items.map((i) => i.header ?? `${i.id}:${i.change}`),
    ["Available Upgrades", "bash:upgrade", "Ignored Upgrades", "wb:upgrade", "Today", "x:new"]);
  assert.deepEqual(itemsOf([], "en-US", { available: [], ignored: [] }), []);
});

test("Changes (F51): Installed scope keeps installed rows, upgrades stay on top; search filters both", () => {
  const now = new Date(2026, 10, 17, 15).getTime();
  const groups = [{ day: new Date(2026, 10, 17).getTime(), rows: [
    { id: "x", name: "Xen", short: "a theme", change: "new" }, { id: "y", name: "Yarn", author: "Saurik", change: "updated" }] }];
  const upgrades = { available: [{ id: "bash", name: "Bash", version: "2", installed: "1" }], ignored: [] };
  const installed = new Set(["bash", "y"]);
  const ids = (o) => itemsOf(groups, "en-US", upgrades, { now, installed, ...o }).map((i) => i.header ?? i.id);
  assert.deepEqual(ids({ scope: "all" }), ["Available Upgrades", "bash", "Today", "x", "y"]);
  assert.deepEqual(ids({ scope: "installed" }), ["Available Upgrades", "bash", "Today", "y"]);
  assert.deepEqual(ids({ scope: "all", query: "saurik" }), ["Today", "y"]);
  assert.deepEqual(ids({ scope: "all", query: "BA" }), ["Available Upgrades", "bash"]);
  assert.deepEqual(ids({ scope: "installed", query: "theme" }), []);
  assert.match(emptyText({ query: "q" }), /match/);
  assert.match(emptyText({ scope: "installed" }), /installed/);
});

test("Changes (F51): default scope is Installed with installs, All without; a pick holds", () => {
  assert.equal(scopeOf(null, new Set(["a"])), "installed");
  assert.equal(scopeOf(null, new Set()), "all");
  assert.equal(scopeOf("all", new Set(["a"])), "all");
  assert.equal(scopeOf("installed", new Set()), "installed");
});
