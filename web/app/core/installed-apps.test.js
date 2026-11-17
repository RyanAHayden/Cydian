// F30: apps installed without a jailbreak, recorded on the device (core/installed.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRecord, recordInstall, removeInstall, appRows, appUpgrades, memoryAppStore, openAppStore, onAppsChange } from "./installed.js";

const DELTA = { id: "com.rileytestut.Delta", name: "Delta", version: "1.5", key: "alt:https://a.example/apps.json",
  source: "https://a.example/apps.json", sourceName: "AltStore", icon: "https://a.example/delta.png" };

test("record: keeps app, version, source and date; a reinstall replaces the record", async () => {
  const store = memoryAppStore();
  let changed = 0;
  const off = onAppsChange(() => changed++);
  const rec = await recordInstall(store, DELTA, 1000);
  assert.deepEqual(rec, { ...DELTA, date: 1000 });
  await recordInstall(store, { ...DELTA, version: "1.6" }, 2000);
  const all = await store.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].version, "1.6");
  assert.equal(all[0].date, 2000);
  assert.equal(changed, 2);
  off();
  assert.throws(() => appRecord({ name: "No id" }), /id/);
  assert.equal(appRecord({ id: " x " }, 5).name, "x"); // no name: the id
});

test("list: newest first, ties by name", async () => {
  const store = memoryAppStore();
  await recordInstall(store, { id: "b", name: "Beta", version: "1" }, 10);
  await recordInstall(store, { id: "a", name: "Alpha", version: "1" }, 10);
  await recordInstall(store, { id: "c", name: "Gamma", version: "1" }, 30);
  assert.deepEqual(appRows(await store.all()).map((r) => r.id), ["c", "a", "b"]);
});

test("upgrades: marked only when a source has a newer version", () => {
  const rows = appRows([
    { id: "new", name: "New", version: "1.2.0", date: 3 },
    { id: "same", name: "Same", version: "2.0", date: 2 },
    { id: "older", name: "Older", version: "3.1", date: 1 },
    { id: "gone", name: "Gone", version: "1.0", date: 0 },
  ]);
  const cands = { new: { version: "1.10.0" }, same: { version: "2.0" }, older: { version: "3.0.9" } };
  const out = appUpgrades(rows, (id) => cands[id] ?? null);
  assert.deepEqual(out.map((r) => [r.id, r.upgrade]), [["new", "1.10.0"], ["same", null], ["older", null], ["gone", null]]);
});

test("remove: the entry goes and listeners hear it", async () => {
  const store = memoryAppStore();
  await recordInstall(store, DELTA, 1);
  await recordInstall(store, { id: "x", name: "X", version: "1" }, 2);
  let changed = 0;
  const off = onAppsChange(() => changed++);
  await removeInstall(store, DELTA.id);
  off();
  assert.deepEqual((await store.all()).map((r) => r.id), ["x"]);
  assert.equal(changed, 1);
  await removeInstall(store, "not-there"); // removing twice is fine
});

test("openAppStore: refuses without IndexedDB", async () => {
  await assert.rejects(openAppStore({ indexedDB: null }), /IndexedDB/);
});
