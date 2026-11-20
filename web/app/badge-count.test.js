// B47: every badge (the tab, the Home Screen icon, the background check's) is the count of Changes' visible upgrade
// rows. User 2026-11-18: "I had a badge on IPA but there was no update" (the sideload app's icon badge). The
// background half is mirrored here from native/sign/Updates.swift (updates + badge), which only builds with Swift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withAppUpgrades } from "./app-updates.js";
import { createUpgradeNotices } from "./settings.js";
import { badgeCount } from "./screens/changes.js";
import { memoryAppStore } from "./core/installed.js";
import { SELF_ALT_URL, selfUpgradeRow, withSelfUpgrade } from "./core/essential.js";
import { watchList } from "./core/appupdates.js";
import { compareVersions } from "./core/apt.js";

const A = "https://a.example/apps.json";
const B = "https://b.example/apps.json"; // removed from Sources since Gone was installed from it
const SELF = "com.ryha.ifizbox";

const records = (selfVersion) => [
  { id: SELF, name: "iFizBox", version: selfVersion, self: true, source: null, date: 0 },
  { id: "delta", name: "Delta", version: "1.5", source: A, date: 1 }, // a real upgrade: 1.6
  { id: "held", name: "Held", version: "1.0", source: A, date: 2 }, // Settings > Ignored Upgrades
  { id: "gone", name: "Gone", version: "1.0", source: B, date: 3 }, // its source removed: no row anywhere
  { id: "lite", name: "Other Variant", version: "1.0", source: A, date: 4 }, // the catalog hides it in this mode (F178)
];
// What the loaded catalog answers (catalog.package): Held is listed, Gone and the hidden variant aren't.
const catalogRows = { delta: "1.6", held: "2.0" };
const lookup = async (id) => (catalogRows[id] ? { key: `alt:${A}`, stanza: { version: catalogRows[id] }, row: { name: id } } : null);
// What the sources themselves serve, which the background check fetches: more than Changes shows.
const served = { [A]: { delta: "1.6", held: "2.0", lite: "9.0" }, [B]: { gone: "2.0" }, [SELF_ALT_URL]: { [SELF]: "0.9.7" } };

// native/sign/Updates.swift updates(_:offers:) and badge(_:pageCount:pageKeys:).
function backgroundBadge(watch, pageCount, offers = served) {
  const found = new Set(watch.apps.filter((w) => offers[w.source]?.[w.id] && compareVersions(offers[w.source][w.id], w.version) > 0).map((w) => w.id));
  const counted = new Set(watch.known.map((k) => k.slice(0, k.indexOf(" "))));
  return Math.max(0, pageCount) + [...found].filter((id) => !counted.has(id)).length;
}

async function changesNow(selfVersion, latestSelf) {
  const calls = [];
  const native = { mode: "sideload", call: async (m, p) => { calls.push([m, p]); return { scheduled: true }; } };
  const base = withSelfUpgrade({ available: [], ignored: [] }, selfUpgradeRow({ version: latestSelf }, selfVersion));
  const store = async () => memoryAppStore(records(selfVersion));
  const upgrades = await withAppUpgrades(base, ["held"], { mode: "sideload", native, store, lookup });
  await new Promise((r) => setTimeout(r, 0));
  const watch = calls.find(([m]) => m === "updates.watch")?.[1];
  return { upgrades, watch, count: badgeCount(upgrades, []) };
}

test("iFizBox up to date: the ignored app, the removed app and the hidden variant count nowhere", async () => {
  const { upgrades, watch, count } = await changesNow("0.9.7", "0.9.7");
  assert.deepEqual(upgrades.available.map((r) => r.id), ["delta"]); // Changes' visible upgrade rows
  assert.deepEqual(upgrades.ignored.map((r) => r.id), ["held"]);
  assert.equal(count, 1);
  // The shell follows only what Changes can count, at the source Changes reads it from.
  assert.deepEqual(watch.apps.map((a) => [a.id, a.source]), [[SELF, SELF_ALT_URL], ["delta", A]]);
  assert.deepEqual(watch.known, ["delta 1.6"]);
  assert.equal(backgroundBadge(watch, count), count);
  // Before B47 the shell followed every record at its own source and badged found.count: 4 for Changes' 1.
  const old = { apps: watchList(records("0.9.7")), known: [] };
  assert.equal(backgroundBadge(old, 0), 4);
});

test("iFizBox's own update is one row, counted once in the background too", async () => {
  const { upgrades, watch, count } = await changesNow("0.9.7", "0.9.8");
  assert.deepEqual(upgrades.available.map((r) => r.id), [SELF, "delta"]);
  assert.equal(count, 2);
  assert.equal(backgroundBadge(watch, count, { ...served, [SELF_ALT_URL]: { [SELF]: "0.9.8" } }), 2);
  // A source failing in the background keeps Changes' count rather than dropping it.
  assert.equal(backgroundBadge(watch, count, {}), 2);
});

test("an update that comes out while iFizBox is closed adds one; a newer version of a counted row doesn't", async () => {
  const { watch, count } = await changesNow("0.9.7", "0.9.7");
  assert.equal(backgroundBadge(watch, count, { ...served, [A]: { ...served[A], delta: "1.7" } }), 1); // still Delta's row
  assert.equal(backgroundBadge(watch, count, { ...served, [SELF_ALT_URL]: { [SELF]: "0.9.9" } }), 2);
});

test("sideload: the icon badge is set to every recount, 0 included and on any tab", () => {
  const calls = [];
  const native = { mode: "sideload", call: async (m, p) => { if (m === "app.badge") calls.push(p.count); } };
  const up = createUpgradeNotices({ native, current: () => ({ tab: "home", path: [] }), win: { location: { hash: "#/home" } } });
  up.badge("changes", 1);
  up.badge("changes", 1); // the background check may have changed the icon since: set again
  up.badge("changes", 0); // the update installed while Home is shown: cleared now, not when Changes opens
  up.badge("home", 5); // not Changes' count
  assert.deepEqual(calls, [1, 1, 0]);
});

// B158: iFizBox 0.12.0 knew 0.13.0 was out (Changes showed 1) but the Home Screen icon had no badge.
test("B158: the first launch after an update clears the icon, then puts Changes' count straight back", () => {
  for (const mode of ["sideload", "jailbreak"]) {
    const calls = [];
    const native = { mode, call: async (m, p) => { if (m === "app.badge") calls.push(p.count); } };
    const up = createUpgradeNotices({ native, current: () => ({ tab: "home", path: [] }), win: { location: { hash: "#/home" } } });
    up.badge("changes", 1); // Changes counted iFizBox's own next update before app.js saw the new version
    up.updated();
    assert.deepEqual(calls, [1, 0, 1], mode); // the last word is the count, not 0
    up.badge("changes", 1); // and every recount sets it again, jailbreak too (it used to skip an unchanged count)
    assert.deepEqual(calls, [1, 0, 1, 1], mode);
  }
  const calls = [];
  const native = { mode: "sideload", call: async (m, p) => { if (m === "app.badge") calls.push(p.count); } };
  const up = createUpgradeNotices({ native, current: () => null, win: { location: { hash: "#/home" } } });
  up.updated(); // nothing counted yet: only the clear; Changes' count follows when it comes
  up.badge("changes", 1);
  assert.deepEqual(calls, [0, 1]);
});

test("B158: back in the foreground the icon gets Changes' last count again", () => {
  const listeners = [];
  const doc = { visibilityState: "hidden", addEventListener: (t, f) => listeners.push([t, f]) };
  const calls = [];
  const native = { mode: "sideload", call: async (m, p) => { if (m === "app.badge") calls.push(p.count); } };
  const win = { location: { hash: "#/home" }, document: doc, addEventListener: () => {} };
  const up = createUpgradeNotices({ native, current: () => null, win });
  assert.equal(up.shown(), false); // nothing counted yet: nothing to set
  up.start();
  up.badge("changes", 1);
  doc.visibilityState = "visible";
  for (const [t, f] of listeners) if (t === "visibilitychange") f();
  assert.deepEqual(calls, [1, 1]);
  // the jailbreak app leaves a 0 to its Changes-tab rule (the daemon's badge may be newer)
  const jb = createUpgradeNotices({ native: { mode: "jailbreak", call: async () => {} }, current: () => null, win: { location: { hash: "#/home" } } });
  jb.badge("changes", 0);
  assert.equal(jb.shown(), false);
  jb.badge("changes", 2);
  assert.equal(jb.shown(), true);
});
