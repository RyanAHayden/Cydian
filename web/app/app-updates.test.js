// I3: Changes' remembered-app upgrades and the sideload shell's watch list (app-updates.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAppUpgrades, shellWatch, rememberedApps } from "./app-updates.js";
import { createNativeBackend } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "../../native/fake/fake-indexeddb.mjs";
import { memoryAppStore } from "./core/installed.js";
import { SELF_ALT_URL } from "./core/essential.js";

const SRC = "https://a.example/apps.json";
const self = { id: "com.ryha.cydian", name: "iFizBox", version: "0.2.6", self: true, source: null, date: 0 };

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
    { id: "com.ryha.cydian", name: "iFizBox", version: "0.2.6", source: SELF_ALT_URL },
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

// ---- F87: the jailbreak app, with I4's real versions (the fake helper's app-versions over CYDIAN_APPS_DIR) ----

const plist = (values) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${
  Object.entries(values).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>\n`).join("")}</dict>\n</plist>\n`;

function jailbreakBackend(t, { apps = true } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const env = {};
  if (apps) {
    const dir = mkdtempSync(join(tmpdir(), "cydian-apps-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const [uuid, name, info] of [
      ["0A1B", "Delta.app", { CFBundleIdentifier: "com.rileytestut.Delta", CFBundleShortVersionString: "1.6", CFBundleVersion: "45" }],
      ["2C3D", "UTM.app", { CFBundleIdentifier: "com.utmapp.UTM", CFBundleShortVersionString: "4.5.2", CFBundleVersion: "98" }],
    ]) {
      mkdirSync(join(dir, uuid, name), { recursive: true });
      writeFileSync(join(dir, uuid, name, "Info.plist"), plist(info));
    }
    env.CYDIAN_APPS_DIR = dir;
  }
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env });
  return createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", queue: createQueue() } });
}

const jbRecords = [
  { ...self, version: "0.2.8" },
  { id: "com.rileytestut.Delta", name: "Delta", version: "1.5", source: SRC, date: 3 }, // updated outside iFizBox to 1.6
  { id: "com.utmapp.UTM", name: "UTM", version: "4.5.2", source: SRC, date: 2 },
  { id: "com.example.gone", name: "Gone", version: "2.0", source: SRC, date: 1 }, // deleted from the Home Screen
];
const offers = (versions) => async (id) => (versions[id] ? { key: "altstore:a", stanza: { version: versions[id] }, row: { name: id } } : null);

test("jailbreak: a remembered app's upgrade is worked out from the version on the phone", async (t) => {
  const backend = jailbreakBackend(t);
  const store = async () => memoryAppStore(jbRecords);
  const dpkg = { available: [{ id: "com.ex.tweak", name: "Tweak", version: "2", installed: "1" }], ignored: [] };
  const lookup = offers({ "com.rileytestut.Delta": "1.7", "com.utmapp.UTM": "4.6", "com.example.gone": "2.1" });
  const up = await withAppUpgrades(dpkg, ["com.utmapp.UTM"], { mode: "jailbreak", backend, store, lookup });
  assert.deepEqual(up.available.map((r) => [r.id, r.installed, r.version]), [
    ["com.rileytestut.Delta", "1.6", "1.7"], // from 1.6 (on the phone), not the remembered 1.5
    ["com.ex.tweak", "1", "2"], // dpkg's row stays
  ]); // Gone isn't installed: no upgrade for it
  assert.deepEqual(up.ignored.map((r) => r.id), ["com.utmapp.UTM"]); // Ignored Upgrades still apply
});

test("jailbreak: an app the source has at the phone's version is no upgrade, though iFizBox remembered an older one", async (t) => {
  const backend = jailbreakBackend(t);
  const store = async () => memoryAppStore(jbRecords);
  const dpkg = { available: [], ignored: [] };
  const up = await withAppUpgrades(dpkg, [], { mode: "jailbreak", backend, store, lookup: offers({ "com.rileytestut.Delta": "1.6" }) });
  assert.deepEqual(up, { available: [], ignored: [] });
});

test("jailbreak: no remembered apps, or a backend without installedApps, leaves dpkg's upgrades as they are", async (t) => {
  const up = { available: [{ id: "x", version: "2" }], ignored: [] };
  const lookup = () => { throw new Error("must not be asked"); };
  assert.equal(await withAppUpgrades(up, [], { mode: "jailbreak", backend: jailbreakBackend(t), store: async () => memoryAppStore([self]), lookup }), up);
  assert.equal(await withAppUpgrades(up, [], { mode: "jailbreak", backend: {}, store: async () => memoryAppStore([self]), lookup }), up);
});

test("jailbreak: rememberedApps carries I4's notes; the site and the sideload app get the records as they are", async (t) => {
  const backend = jailbreakBackend(t);
  const store = async () => memoryAppStore(jbRecords);
  const notes = Object.fromEntries((await rememberedApps({ mode: "jailbreak", backend, store })).map((r) => [r.id, r.note ?? null]));
  assert.deepEqual(notes, {
    "com.ryha.cydian": null,
    "com.rileytestut.Delta": "Installed: 1.6 (iFizBox remembered 1.5)",
    "com.utmapp.UTM": null,
    "com.example.gone": "Not installed (iFizBox remembered 2.0)",
  });
  const boom = { installedApps: () => { throw new Error("must not be asked"); } };
  assert.deepEqual(await rememberedApps({ mode: "sideload", backend: boom, store }), jbRecords);
  // installedApps failing (the helper gone): the records stand.
  const failing = { installedApps: async () => { throw new Error("no helper"); } };
  assert.deepEqual(await rememberedApps({ mode: "jailbreak", backend: failing, store }), jbRecords);
});
