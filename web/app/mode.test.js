import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { tabsFor, APT_ONLY_TABS } from "./mode.js";
import { detectMode } from "./core/settings.js";

const ALL = ["home", "sources", "changes", "installed", "search", "settings"];

test("sideload drops the apt-only tabs, the others keep every tab", () => {
  assert.deepEqual(tabsFor(ALL, "sideload"), ALL.filter((t) => !APT_ONLY_TABS.includes(t)));
  assert.ok(!tabsFor(ALL, "sideload").includes("installed"));
  assert.deepEqual(tabsFor(ALL, "jailbreak"), ALL);
  assert.deepEqual(tabsFor(ALL, "site"), ALL);
});

test("native/bridge.js sets cydianNative.mode from @MODE@, and detectMode reads it", () => {
  const src = readFileSync(join(import.meta.dirname, "../../native/bridge.js"), "utf8").replace("})(globalThis);", "})(this);");
  const run = (s) => {
    const ctx = vm.createContext({ webkit: { messageHandlers: { cydian: { postMessage() {} } } } });
    vm.runInContext(s, ctx);
    return ctx;
  };
  assert.equal(detectMode(run(src.replaceAll("@MODE@", "sideload"))), "sideload");
  assert.equal(detectMode(run(src.replaceAll("@MODE@", "jailbreak"))), "jailbreak");
  const raw = run(src); // left unfilled: no mode, which reads as the jailbreak shell
  assert.equal(raw.cydianNative.mode, undefined);
  assert.equal(detectMode(raw), "jailbreak");
});

test("in sideload mode the router has no apt-only tabs, and their deep links land on home", async () => {
  globalThis.cydianNative = { mode: "sideload" };
  try {
    const r = await import("./router.js?sideload"); // a fresh copy, so TABS is worked out under this mode
    assert.ok(!r.TABS.includes("installed"));
    assert.ok(r.TABS.includes("settings"));
    assert.deepEqual(r.parse("#/installed"), { tab: "home", path: [] });
    assert.deepEqual(r.parse("#/changes"), { tab: "changes", path: [] });
  } finally {
    delete globalThis.cydianNative;
  }
});
