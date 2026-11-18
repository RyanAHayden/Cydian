// I3: Changes' remembered-app upgrades and the sideload shell's watch list (app-updates.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { withAppUpgrades, shellWatch } from "./app-updates.js";
import { memoryAppStore } from "./core/installed.js";
import { SELF_ALT_URL } from "./core/essential.js";

const SRC = "https://a.example/apps.json";
const self = { id: "com.ryha.cydian", name: "Cydian", version: "0.2.6", self: true, source: null, date: 0 };

test("jailbreak mode leaves dpkg's upgrades as they are", async () => {
  const up = { available: [{ id: "x", version: "2" }], ignored: [] };
  const store = () => Promise.reject(new Error("must not be read"));
  assert.equal(await withAppUpgrades(up, [], { mode: "jailbreak", store }), up);
});

test("sideload: no sources loaded yet, nothing new to show, and the shell is told what to follow", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { scheduled: true }; } };
  const store = async () => memoryAppStore([self, { id: "delta", name: "Delta", version: "1.5", source: SRC, date: 1 }]);
  const up = await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "sideload", native, store });
  assert.deepEqual(up, { available: [], ignored: [] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [["updates.watch", { apps: [
    { id: "com.ryha.cydian", name: "Cydian", version: "0.2.6", source: SELF_ALT_URL },
    { id: "delta", name: "Delta", version: "1.5", source: SRC }], known: [] }]]);
  // The same list again isn't sent twice.
  await withAppUpgrades({ available: [], ignored: [] }, [], { mode: "sideload", native, store });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
});

test("the shell's known list is every upgrade already counted on screen", () => {
  const w = shellWatch([{ id: "delta", name: "Delta", version: "1.5", source: SRC }], [{ id: "delta", version: "1.6" }, { id: "com.ryha.cydian", version: "0.3" }]);
  assert.deepEqual(w.known, ["com.ryha.cydian 0.3", "delta 1.6"]);
  assert.deepEqual(w.apps.map((a) => a.id), ["delta"]);
});
