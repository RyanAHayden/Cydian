// F302: the sideload build's tweaks from APT sources, screens/tweaks.js side: the .deb check cached per package and
// version, Add to App's choice of apps (the filter's apps offered, the rest named as not targeted), and the .deb kept
// with that app's tweaks so its next sign injects it.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tweakInfo, cachedTweakInfo, addDebTo, addToApp, splitApps, signableApps, savedTweaks, INFO_KEY } from "./tweaks.js";
import { memoryIpaStore } from "../core/myipas.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/tweaks/${n}`, import.meta.url)));
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const st = (o = {}) => ({ package: "com.me.fixture", name: "Fixture", version: "1.0", debUrl: "https://repo.x/fixture.deb", depends: "mobilesubstrate", ...o });

test("tweakInfo reads the .deb once per package and version, and keeps the answer on the device", async () => {
  const s = storage();
  let fetched = 0;
  const fetchDeb = async () => { fetched++; return fx("tweak-xz.deb"); };
  const info = await tweakInfo(st({ version: "1.0-a" }), { fetchDeb, storage: s });
  assert.equal(info.ok, true, info.why);
  assert.deepEqual(info.bundles, ["com.me.fixture"]);
  await tweakInfo(st({ version: "1.0-a" }), { fetchDeb, storage: s });
  assert.equal(fetched, 1);
  assert.ok(JSON.parse(s.m.get(INFO_KEY))["com.me.fixture@1.0-a"]);
  assert.deepEqual(cachedTweakInfo(st({ version: "1.0-a" }), { storage: s }).bundles, ["com.me.fixture"]);
  assert.equal(cachedTweakInfo(st({ version: "2.0" }), { storage: s }), null, "another version is checked again");
  // not a .deb: kept as can't-take; a failed download isn't kept
  const bad = await tweakInfo(st({ version: "bad" }), { fetchDeb: async () => new Uint8Array([1, 2, 3]), storage: s });
  assert.equal(bad.ok, false);
  await assert.rejects(tweakInfo(st({ version: "down" }), { fetchDeb: async () => { throw new Error("offline"); }, storage: s }), /couldn't be downloaded/);
  assert.equal(cachedTweakInfo(st({ version: "down" }), { storage: s }), null);
});

test("addDebTo keeps the .deb with the app's tweaks, replacing an older version of the same package", async () => {
  const mem = memoryIpaStore();
  const store = async () => mem;
  await addDebTo("com.me.fixture", st({ version: "1.0" }), new Uint8Array([1]), { store });
  await addDebTo("com.me.fixture", st({ version: "1.1" }), new Uint8Array([2]), { store });
  await addDebTo("com.me.fixture", st({ package: "com.other", version: "3" }), new Uint8Array([3]), { store });
  assert.deepEqual((await savedTweaks("com.me.fixture", { store })).map((x) => x.name), ["com.me.fixture_1.1.deb", "com.other_3.deb"]);
});

test("splitApps and signableApps: the filter's apps are made for it; My IPAs and signed apps listed once each", async () => {
  const apps = await signableApps({
    library: async () => [{ bundleId: "com.me.fixture", name: "Fixture.ipa", options: { name: "Fixture" } }, { bundleId: "com.x.other", name: "Other" }],
    records: async () => [{ id: "com.me.fixture", name: "dupe" }, { id: "com.y.signed", name: "Signed App" }, { id: "self", self: true }],
  });
  assert.deepEqual(apps.map((a) => a.bundleId), ["com.me.fixture", "com.x.other", "com.y.signed"]);
  const { made, not } = splitApps({ ok: true, bundles: ["com.me.fixture"] }, apps);
  assert.deepEqual(made.map((a) => a.name), ["Fixture"]);
  assert.deepEqual(not.map((a) => a.name), ["Other", "Signed App"]);
  assert.equal(splitApps({ ok: true, anyApp: true, bundles: [] }, apps).made.length, 3);
});

test("addToApp: checks under a HUD, offers the apps it's made for, names the rest, and keeps the .deb for the chosen one", async () => {
  const mem = memoryIpaStore();
  const store = async () => mem;
  const seen = { huds: 0, sheets: [], alerts: [] };
  const app = await addToApp(st({ version: "9" }), {
    hud: () => { seen.huds++; return () => {}; },
    sheet: async (o) => { seen.sheets.push(o); return 0; },
    alert: async (o) => { seen.alerts.push(o); return 0; },
    apps: async () => [{ bundleId: "com.me.fixture", name: "Fixture" }, { bundleId: "com.x.other", name: "Other" }],
    fetchDeb: async () => fx("tweak-xz.deb"), storage: storage(), store,
  });
  assert.equal(app.bundleId, "com.me.fixture");
  assert.equal(seen.huds, 1);
  assert.deepEqual(seen.sheets[0].buttons, ["Fixture"]);
  assert.match(seen.sheets[0].title, /Not targeted: Other/);
  assert.equal(seen.alerts.at(-1).title, "Tweak Added");
  assert.deepEqual((await savedTweaks("com.me.fixture", { store })).map((x) => x.name), ["com.me.fixture_9.deb"]);
  // nobody's app: says which apps it works in, adds nothing
  const none = [];
  assert.equal(await addToApp(st({ version: "9" }), { hud: () => () => {}, sheet: async () => 0, alert: async (o) => { none.push(o); },
    apps: async () => [{ bundleId: "com.x.other", name: "Other" }], fetchDeb: async () => fx("tweak-xz.deb"), storage: storage(), store }), null);
  assert.equal(none[0].title, "No App for This Tweak");
});
