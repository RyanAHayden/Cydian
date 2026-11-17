import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsOf, nav } from "./changes.js";
import { pageOf, token } from "./browse.js";

test("Changes: a header per group, newest first, then its rows; package pages open below the tab", () => {
  const t1 = Date.UTC(2026, 10, 17, 12, 0, 0), t0 = t1 - 86400000;
  const items = itemsOf([
    { seen: t1, rows: [{ id: "a", name: "A", change: "updated" }] },
    { seen: t0, rows: [{ id: "b", name: "B", change: "new" }, { id: "c", name: "C", change: "new" }] },
  ], "en-US");
  assert.deepEqual(items.map((i) => i.header ?? i.id), [items[0].header, "a", items[2].header, "b", "c"]);
  assert.match(items[0].header, /^New at Nov 1[78], 2026/);
  assert.equal(nav({ tab: "changes", path: [] }).left.label, "Refresh");
  assert.deepEqual(pageOf({ tab: "changes", path: [token("package", "a")] }), { key: "*", page: "package", value: "a" });
});
