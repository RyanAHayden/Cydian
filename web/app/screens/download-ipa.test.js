// Download IPA on an app page opens the source's exact downloadURL: in a Safari tab (window.open) and in the Home
// Screen web app, where app.js routes window.open through core/applinks.js openOutside. A GitHub release asset must
// not become github://… (the GitHub app can't download it and shows only its home); Safari gets the exact URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows } from "./altstore.js";
import { parseAltSource } from "../core/altstore.js";
import { siteGateRows } from "../websign-gate.js";
import { openOutside } from "../core/applinks.js";

// opentennis's source (releases/latest/download/altstore-source.json), trimmed to what the rows read.
const IPA = "https://github.com/FIZL0/opentennis/releases/download/v1.8.0/opentennis-ios.ipa";
const SOURCE = {
  name: "opentennis", identifier: "com.fizl0.opentennis.source",
  apps: [{ name: "opentennis", bundleIdentifier: "com.fizl0.opentennis", developerName: "FIZL0",
    versions: [{ version: "1.8.0", date: "2026-11-18", downloadURL: IPA, size: 12345678 }] }],
};
const SOURCE_URL = "https://github.com/FIZL0/opentennis/releases/latest/download/altstore-source.json";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const version = () => parseAltSource(SOURCE).apps[0].versions[0];
const tapDownload = (rows) => rows.find((r) => r.label === "Download IPA").onClick();

test("opentennis: the parsed source keeps the exact downloadURL", () => {
  assert.equal(version().downloadURL, IPA);
});

test("opentennis on the website (gated rows): Download IPA opens the exact IPA URL", () => {
  const opened = [];
  const gate = (o) => siteGateRows({ ...o, storage: memory(), open: () => {}, alert: async () => ({ index: 0 }) });
  const { rows, gated } = installRows(version(), SOURCE_URL, (u) => opened.push(u), () => {}, null, "opentennis",
    { site: true, jailbreak: false, custom: false, appId: "com.fizl0.opentennis", gate });
  assert.equal(gated, true);
  const row = rows.find((r) => r.label === "Download IPA");
  assert.equal(row.subtitle, "opentennis-ios.ipa");
  tapDownload(rows);
  assert.deepEqual(opened, [IPA]);
});

test("opentennis in the sideload app: Download IPA opens the exact IPA URL", () => {
  const opened = [];
  const { rows } = installRows(version(), SOURCE_URL, (u) => opened.push(u), () => {}, null, "opentennis",
    { site: false, jailbreak: false, custom: false });
  tapDownload(rows);
  assert.deepEqual(opened, [IPA]);
});

test("opentennis from the Home Screen web app: Safari gets the exact IPA URL, not the GitHub app", () => {
  const went = [];
  // app.js's standalone window.open: openOutside with go = location.href
  const opener = (u) => openOutside(u, { go: (x) => went.push(x), wait: () => { throw new Error("no app-first timer"); } });
  const gate = (o) => siteGateRows({ ...o, storage: memory(), open: () => {}, alert: async () => ({ index: 0 }) });
  const { rows } = installRows(version(), SOURCE_URL, opener, () => {}, null, "opentennis",
    { site: true, jailbreak: false, custom: false, appId: "com.fizl0.opentennis", gate });
  tapDownload(rows);
  assert.deepEqual(went, ["x-safari-" + IPA]);
});
