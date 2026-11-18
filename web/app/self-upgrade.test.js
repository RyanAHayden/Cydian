// B34: the sideload app at 0.9.3 with 0.9.4 in iFizBox's built-in AltStore source (web/app/source.json). The whole
// chain Changes uses (essential-ui.js upgradesWithSelf, then app-updates.js withAppUpgrades, as screens/changes.js
// badge() and load() call them) must give a row on top of Changes, count it in the tab badge (and so in app.badge,
// settings.js createUpgradeNotices), and hand the background check (updates.watch, BackgroundCheck.swift) iFizBox
// itself at the running version, followed through that source, which offers the newer one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { upgradesWithSelf } from "./essential-ui.js";
import { withAppUpgrades } from "./app-updates.js";
import { badgeCount } from "./screens/changes.js";
import { memoryAppStore, withSelf } from "./core/installed.js";
import { SELF_ALT_URL, SELF_ID, saveInfo, selfFromAltSource } from "./core/essential.js";
import { compareVersions } from "./core/apt.js";

const SOURCE = JSON.parse(readFileSync(new URL("./source.json", import.meta.url), "utf8"));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("B34: the built-in source lists the current iFizBox as iFizBox.ipa under com.ryha.ifizbox", () => {
  assert.equal(SOURCE.identifier, SELF_ID);
  const app = SOURCE.apps.find((a) => a.bundleIdentifier === SELF_ID);
  assert.ok(app, "iFizBox is in its own source");
  const newest = app.versions[0];
  assert.ok(compareVersions(newest.version, "0.9.4") >= 0, `source lists ${newest.version}`);
  assert.match(newest.downloadURL, new RegExp(`/v${newest.version.replace(/\./g, "\\.")}/iFizBox\\.ipa$`));
  assert.equal(selfFromAltSource(SOURCE).version, newest.version);
});

test("B34: sideload 0.9.3 + a newer iFizBox in the built-in source: a row in Changes, the badge, the background watch", async (t) => {
  const calls = [];
  const native = {
    mode: "sideload",
    call: async (m, p) => {
      calls.push([m, p]);
      if (m === "app.info") return { version: "0.9.3", mode: "sideload" };
      if (m === "updates.watch") return { scheduled: true };
      return null;
    },
  };
  const storage = memoryStorage();
  const savedNative = globalThis.ifizboxNative;
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  globalThis.ifizboxNative = native;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  t.after(() => {
    globalThis.ifizboxNative = savedNative;
    if (savedStorage) Object.defineProperty(globalThis, "localStorage", savedStorage);
    else delete globalThis.localStorage;
  });

  // What essential-ui.js readSelfInfo keeps after reading the built-in source.
  saveInfo(storage, selfFromAltSource(SOURCE));
  const newest = selfFromAltSource(SOURCE).version;

  // screens/changes.js badge(): catalog.upgrades (none: no dpkg in the sideload app), then iFizBox's own row, then
  // the remembered apps (only iFizBox itself, which installed.js withSelf lists at app.info's version).
  const store = async () => withSelf(memoryAppStore([]), native);
  const up = await withAppUpgrades(await upgradesWithSelf({ available: [], ignored: [] }), [], { mode: "sideload", native, store });

  assert.equal(up.available.length, 1);
  const row = up.available[0];
  assert.equal(row.id, SELF_ID);
  assert.equal(row.version, newest);
  assert.equal(row.installed, "0.9.3");
  assert.match(row.ipa, /\/iFizBox\.ipa$/);
  assert.equal(badgeCount(up), 1, "the Changes tab badge (and the icon badge it sets) counts it");

  await new Promise((r) => setTimeout(r, 0));
  const watch = calls.find(([m]) => m === "updates.watch")?.[1];
  assert.ok(watch, "the background check is told what to follow");
  const me = watch.apps.find((a) => a.id === SELF_ID);
  assert.deepEqual(me, { id: SELF_ID, name: "iFizBox", version: "0.9.3", source: SELF_ALT_URL });
  // What that source offers (BackgroundCheck reads it with Updates.swift offers/updates: the first version listed)
  // is newer than what runs, so the background check reports it.
  const offer = SOURCE.apps.find((a) => a.bundleIdentifier === SELF_ID).versions[0].version;
  assert.ok(compareVersions(offer, me.version) > 0);
  assert.deepEqual(watch.known, [`${SELF_ID} ${newest}`]);
});
