// B229: Install IPAs on iOS 27, where apps.isInstalled can't tell (null for every app, Sideload.swift
// Workspace.seesInstalls): a row installed through the IPA queue counts as installed by the shell's own record of
// signing it (signing.installed), when Installed's records don't have it (the queue writes those only once iOS confirms).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installedOf } from "./myipas.js";

const LIST = [
  { file: "R31Test.ipa", name: "R31Test", bundleId: "com.x.r31test", signed: null },
  { file: "Other.ipa", name: "Other", bundleId: "com.x.other", signed: null },
];
const unknown = { call: async () => ({ installed: { "com.x.r31test": null, "com.x.other": null } }) };

test("B229: an id iOS can't answer counts by the shell's signed record in the sideload app", async () => {
  const map = await installedOf(LIST, { mode: "sideload", native: unknown, records: async () => [],
    signed: async () => [{ bundleId: "com.x.r31test", originalBundleId: "com.x.r31test" }] });
  assert.deepEqual(map, { "com.x.r31test": true });
  // an old-way copy (Keep Bundle IDs off): installed under the profile's ID, its record keeps the IPA's own
  const old = await installedOf(LIST, { mode: "sideload", native: unknown, records: async () => [],
    signed: async () => [{ bundleId: "S8NFX3A2LT.com.x.other", originalBundleId: "com.x.other" }] });
  assert.deepEqual(old, { "com.x.other": true });
});

test("B229: the shell's records are asked once, and only when Installed's records don't settle it", async () => {
  let asked = 0;
  const signed = async () => { asked++; return []; };
  await installedOf(LIST, { mode: "sideload", native: unknown, records: async () => [], signed });
  assert.equal(asked, 1);
  asked = 0;
  const map = await installedOf(LIST, { mode: "sideload", native: unknown,
    records: async () => [{ id: "com.x.r31test" }, { id: "com.x.other" }], signed });
  assert.equal(asked, 0);
  assert.deepEqual(map, { "com.x.r31test": true, "com.x.other": true });
});

test("B229: iOS's own false still wins over a signed record; the jailbreak app and a failing call ask nothing more", async () => {
  const no = { call: async () => ({ installed: { "com.x.r31test": false, "com.x.other": false } }) };
  const rec = async () => [{ bundleId: "com.x.r31test" }];
  assert.deepEqual(await installedOf(LIST, { mode: "sideload", native: no, records: async () => [], signed: rec }), {});
  assert.deepEqual(await installedOf(LIST, { mode: "jailbreak", native: unknown, records: async () => [],
    signed: async () => assert.fail("the jailbreak build refuses signing.*") }), {});
  assert.deepEqual(await installedOf(LIST, { mode: "sideload", native: unknown, records: async () => [],
    signed: async () => { throw new Error("no certificate"); } }), {});
});

test("B229: the default asks signing.installed over the bridge", async () => {
  const calls = [];
  const native = { call: async (m) => {
    calls.push(m);
    if (m === "apps.isInstalled") return { installed: { "com.x.r31test": null } };
    if (m === "signing.installed") return { apps: [{ bundleId: "com.x.r31test" }], next: null };
    return null;
  } };
  const map = await installedOf(LIST.slice(0, 1), { mode: "sideload", native, records: async () => [] });
  assert.deepEqual(calls, ["apps.isInstalled", "signing.installed"]);
  assert.deepEqual(map, { "com.x.r31test": true });
});
