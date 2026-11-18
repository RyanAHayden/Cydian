// I3: remembered-version upgrades (core/appupdates.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberedUpgrades, mergeUpgrades, watchList, upgradeKeys, updatesTitle, SELF_ID } from "./appupdates.js";
import { memoryAppStore, recordInstall, apps, withSelf } from "./installed.js";
import { parseAltSource, appStanza } from "./altstore.js";

const SRC = "https://a.example/apps.json";
const rec = (id, version, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), version, key: `alt:${SRC}`, source: SRC,
  sourceName: "A", icon: null, date: 1, ...extra });
const cands = (m) => (id) => (m[id] ? { id, name: id[0].toUpperCase() + id.slice(1), version: m[id], key: `alt:${SRC}`, icon: `${id}.png` } : null);

test("a newer version on a source than the one remembered is an upgrade; same, older or gone is not", () => {
  const records = [rec("delta", "1.5"), rec("utm", "4.5"), rec("old", "3.1"), rec("gone", "1.0")];
  const up = rememberedUpgrades(records, cands({ delta: "1.6", utm: "4.5", old: "3.0" }));
  assert.deepEqual(up.available.map((r) => [r.id, r.installed, r.version]), [["delta", "1.5", "1.6"]]);
  assert.equal(up.available[0].key, `alt:${SRC}`);
  assert.equal(up.available[0].icon, "delta.png");
  assert.equal(up.available[0].remembered, true);
  assert.deepEqual(up.ignored, []);
});

test("versions compare as versions, not text: 1.10 is newer than 1.9", () => {
  const up = rememberedUpgrades([rec("a", "1.9"), rec("b", "2.0~b1")], cands({ a: "1.10", b: "2.0" }));
  assert.deepEqual(up.available.map((r) => r.id), ["a", "b"]);
  assert.equal(rememberedUpgrades([rec("a", "1.10")], cands({ a: "1.9" })).available.length, 0);
});

test("Ignored Upgrades holds an app's upgrade under ignored; no version remembered, or Cydian itself, is skipped", () => {
  const records = [rec("delta", "1.5"), rec("utm", "4.0"), rec("blank", ""), { ...rec(SELF_ID, "0.1"), self: true }];
  const up = rememberedUpgrades(records, cands({ delta: "1.6", utm: "4.5", blank: "1.0", [SELF_ID]: "9.9" }), ["utm"]);
  assert.deepEqual(up.available.map((r) => r.id), ["delta"]);
  assert.deepEqual(up.ignored.map((r) => r.id), ["utm"]);
});

test("Install records the version downloaded; a later source refresh with a bump makes it an upgrade", async () => {
  const store = memoryAppStore();
  const v1 = parseAltSource({ name: "A", apps: [{ name: "Delta", bundleIdentifier: "delta", versions: [{ version: "1.5", downloadURL: "https://a.example/d.ipa" }] }] });
  const st1 = appStanza(v1.apps[0], { url: SRC, name: "A" });
  await recordInstall(store, { id: "delta", name: "Delta", version: st1.version, source: SRC });
  const pkgs = (st) => (id) => (id === st.package ? { id, name: st.name, version: st.version, key: `alt:${SRC}` } : null);
  assert.equal(rememberedUpgrades(await store.all(), pkgs(st1)).available.length, 0);
  const v2 = parseAltSource({ name: "A", apps: [{ name: "Delta", bundleIdentifier: "delta", versions: [
    { version: "1.6", downloadURL: "https://a.example/d16.ipa", minOSVersion: "99.0" }, // this phone can't run it: not offered
    { version: "1.5", downloadURL: "https://a.example/d.ipa" }] }] });
  assert.equal(rememberedUpgrades(await store.all(), pkgs(appStanza(v2.apps[0], { url: SRC }, "17.0"))).available.length, 0);
  const v3 = parseAltSource({ name: "A", apps: [{ name: "Delta", bundleIdentifier: "delta", versions: [
    { version: "1.7", downloadURL: "https://a.example/d17.ipa" }, { version: "1.5", downloadURL: "https://a.example/d.ipa" }] }] });
  const up = rememberedUpgrades(await store.all(), pkgs(appStanza(v3.apps[0], { url: SRC }, "17.0")));
  assert.deepEqual(up.available.map((r) => [r.id, r.installed, r.version]), [["delta", "1.5", "1.7"]]);
  // Installing the upgrade records 1.7: nothing left to show.
  await recordInstall(store, { id: "delta", name: "Delta", version: "1.7", source: SRC });
  assert.equal(rememberedUpgrades(await store.all(), pkgs(appStanza(v3.apps[0], { url: SRC }, "17.0"))).available.length, 0);
});

test("merge: dpkg's and the remembered apps' upgrades in one list, each id once, Cydian's own row first", () => {
  const dpkg = { available: [{ id: SELF_ID, name: "Cydian", version: "2" }, { id: "zeta", name: "Zeta", version: "1" }], ignored: [{ id: "held", name: "Held", version: "1" }] };
  const apps_ = { available: [{ id: "alpha", name: "Alpha", version: "2" }, { id: "zeta", name: "Zeta (app)", version: "9" }, { id: "held", name: "Held", version: "3" }], ignored: [] };
  const m = mergeUpgrades(dpkg, apps_);
  assert.deepEqual(m.available.map((r) => r.id), [SELF_ID, "alpha", "zeta"]);
  assert.equal(m.available.find((r) => r.id === "zeta").name, "Zeta"); // the first list's row wins
  assert.deepEqual(m.ignored.map((r) => r.id), ["held"]);
  assert.deepEqual(mergeUpgrades(null, null), { available: [], ignored: [] });
});

test("watch list for the shell: http(s) source and a version only; Cydian's self record is left to essential.js", async () => {
  const native = { call: async () => ({ mode: "sideload", version: "0.2.6" }) };
  const store = withSelf(memoryAppStore([rec("delta", "1.5"), rec("local", "1", { source: null }), rec("bad", "1", { source: "javascript:x" }),
    rec("nov", "")]), native);
  const all = await store.all();
  assert.equal(all[0].id, SELF_ID);
  assert.deepEqual(watchList(all), [{ id: "delta", name: "Delta", version: "1.5", source: SRC }]);
  assert.equal(typeof apps, "function");
});

test("known keys and the notification title", () => {
  assert.deepEqual(upgradeKeys([{ id: "b", version: "2" }, { id: "a", version: "1.6" }, { id: "x" }]), ["a 1.6", "b 2"]);
  assert.equal(updatesTitle(1), "1 Update");
  assert.equal(updatesTitle(3), "3 Updates");
});
