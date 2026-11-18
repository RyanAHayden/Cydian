import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { detectMode } from "./core/settings.js";

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

test("in sideload mode the router has Installed too", async () => {
  globalThis.cydianNative = { mode: "sideload" };
  try {
    const r = await import("./router.js?sideload"); // a fresh copy, so TABS is worked out under this mode
    assert.ok(r.TABS.includes("installed"));
    assert.ok(r.TABS.includes("settings"));
    assert.deepEqual(r.parse("#/installed"), { tab: "installed", path: [] });
    assert.deepEqual(r.parse("#/changes"), { tab: "changes", path: [] });
  } finally {
    delete globalThis.cydianNative;
  }
});
