import { test } from "node:test";
import assert from "node:assert/strict";
import { getMode, tabsFor, APT_ONLY_TABS } from "./mode.js";

const ALL = ["home", "sources", "changes", "installed", "search"];

test("mode comes from globalThis.cydianApp, web when absent or unknown", () => {
  assert.equal(getMode({}), "web");
  assert.equal(getMode(undefined), "web");
  assert.equal(getMode({ cydianApp: { mode: "sideload" } }), "sideload");
  assert.equal(getMode({ cydianApp: { mode: "jailbreak" } }), "jailbreak");
  assert.equal(getMode({ cydianApp: { mode: "root" } }), "web");
});

test("sideload drops the apt-only tabs, the others keep every tab", () => {
  assert.deepEqual(tabsFor(ALL, "sideload"), ALL.filter((t) => !APT_ONLY_TABS.includes(t)));
  assert.ok(!tabsFor(ALL, "sideload").includes("installed"));
  assert.deepEqual(tabsFor(ALL, "jailbreak"), ALL);
  assert.deepEqual(tabsFor(ALL, "web"), ALL);
});

test("in sideload mode the router has no apt-only tabs, and their deep links land on home", async () => {
  globalThis.cydianApp = { mode: "sideload" };
  try {
    const r = await import("./router.js?sideload"); // a fresh copy, so TABS is worked out under this mode
    assert.ok(!r.TABS.includes("installed"));
    assert.deepEqual(r.parse("#/installed"), { tab: "home", path: [] });
    assert.deepEqual(r.parse("#/changes"), { tab: "changes", path: [] });
  } finally {
    delete globalThis.cydianApp;
  }
});
