import { test } from "node:test";
import assert from "node:assert/strict";
import { allAppsRows, topRowsOf, ALL_APPS } from "./allapps.js";
import { pageOf } from "../screens/browse.js";

const row = (id, version, key, name = id) => ({ id, version, key, name });

test("All Apps keeps AltStore apps only, one per bundle ID, newest version", () => {
  const rows = [
    row("com.a.app", "1.2", "alt:https://one/apps.json", "A"),
    row("com.a.app~2", "1.10", "alt:https://two/apps.json", "A"),
    row("com.b.tweak", "3.0", "https://repo.example/", "B"),
    row("com.c.app", "2.0", "alt:https://two/apps.json", "C"),
  ];
  assert.deepEqual(allAppsRows(rows).map((r) => r.id), ["com.a.app~2", "com.c.app"]);
  assert.deepEqual(allAppsRows([]), []);
});

test("All Apps takes All Sources' place when only AltStore sources show, joins it otherwise", () => {
  assert.deepEqual(topRowsOf({ appsOnly: true, hasAlt: false }), { allSources: false, allApps: true });
  assert.deepEqual(topRowsOf({ appsOnly: false, hasAlt: false }), { allSources: true, allApps: false });
  assert.deepEqual(topRowsOf({ appsOnly: false, hasAlt: true }), { allSources: true, allApps: true });
  assert.deepEqual(topRowsOf({ appsOnly: true, hasAlt: true, searching: true }), { allSources: false, allApps: false });
  assert.deepEqual(topRowsOf({ appsOnly: false, hasAlt: true, searching: true }), { allSources: false, allApps: false });
});

test("the All Apps route: its list, and app pages read from the merged catalog", () => {
  assert.deepEqual(pageOf({ tab: "sources", path: [ALL_APPS] }), { key: "*", page: "apps" });
  assert.deepEqual(pageOf({ tab: "sources", path: [ALL_APPS, "package:com.a.app"] }), { key: "*", page: "package", value: "com.a.app" });
  assert.deepEqual(pageOf({ tab: "sources", path: ["alt:x"] }), { key: "alt:x", page: "sections" });
});
