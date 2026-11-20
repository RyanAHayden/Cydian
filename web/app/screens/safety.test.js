// F291: the safety nets' screen glue (screens/safety.js) with fake alerts, storage and servers: no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installSafety, confirmUnknownSource, lookForPatch, resetPatchAsked, patchUpgrades, reportMalicious } from "./safety.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const alerts = (answers = []) => {
  const seen = [];
  const alert = async (a) => { seen.push(a); return { index: answers.shift() ?? 0, value: "" }; };
  return { seen, alert };
};
const quiet = async () => ({ enabled: true, count: 0, reasons: {} });
const unknownJob = { id: "com.cool.gba", name: "GBA4U", version: "3.0", source: "https://cool-ipas.xyz/apps.json" };
const safeJob = { id: "com.rileytestut.Delta", name: "Delta", version: "1.6", source: "https://apps.altstore.io/" };

test("installSafety: an exploitable iOS and an untrusted source: the alert once, then quiet", async () => {
  const storage = mem();
  const a = alerts([1]); // I Understand (Software Update is first)
  const opts = { alert: a.alert, mode: "sideload", ios: () => "16.2", storage, trusted: [], summary: quiet, canOpenSettings: true, open: async () => true };
  assert.equal(await installSafety([unknownJob], opts), true);
  assert.equal(a.seen.length, 1);
  assert.equal(a.seen[0].title, "Check Before You Install");
  assert.equal(await installSafety([unknownJob], opts), true);
  assert.equal(a.seen.length, 1, "once per iOS version");
});

test("installSafety: Software Update opens Settings and stops this install", async () => {
  const opened = [];
  const a = alerts([0]);
  const ok = await installSafety([unknownJob], { alert: a.alert, mode: "sideload", ios: () => "16.2", storage: mem(), trusted: [],
    summary: quiet, canOpenSettings: true, open: async (u) => { opened.push(u); return true; } });
  assert.equal(ok, false);
  assert.match(opened[0], /SOFTWARE_UPDATE/);
});

test("installSafety: quiet for trusted and known-safe sources, safe iOS versions and the jailbreak build", async () => {
  const a = alerts();
  const base = { alert: a.alert, storage: mem(), summary: quiet };
  assert.equal(await installSafety([safeJob], { ...base, mode: "sideload", ios: () => "16.2", trusted: [] }), true);
  assert.equal(await installSafety([unknownJob], { ...base, mode: "sideload", ios: () => "16.2", trusted: ["cool-ipas.xyz"] }), true);
  assert.equal(await installSafety([unknownJob], { ...base, mode: "site", ios: () => "17.5", trusted: [] }), true);
  assert.equal(await installSafety([unknownJob], { ...base, mode: "jailbreak", ios: () => "16.2", trusted: [] }), true);
  assert.equal(await installSafety([{ ...unknownJob, op: "remove" }], { ...base, mode: "sideload", ios: () => "16.2", trusted: [] }), true);
  assert.equal(a.seen.length, 0);
});

test("installSafety: a reported version asks first; Cancel stops, Install Anyway goes on and isn't asked again", async () => {
  const flagged = async () => ({ enabled: true, count: 12, reasons: { logins: 12 } });
  const job = { ...unknownJob, id: "com.flagged.app", version: "9" };
  const a = alerts([0]);
  const base = { mode: "jailbreak", ios: () => "17.5", storage: mem(), trusted: [], summary: flagged };
  assert.equal(await installSafety([job], { ...base, alert: a.alert }), false);
  assert.equal(a.seen[0].title, "Reported as Malicious");
  const b = alerts([1]);
  assert.equal(await installSafety([job], { ...base, alert: b.alert }), true);
  const c = alerts([0]);
  assert.equal(await installSafety([job], { ...base, alert: c.alert }), true);
  assert.equal(c.seen.length, 0, "Install Anyway holds for the session");
});

test("installSafety: a slow or dead report server says nothing", async () => {
  const a = alerts();
  const slow = () => new Promise(() => {});
  assert.equal(await installSafety([unknownJob], { alert: a.alert, mode: "jailbreak", ios: () => "17.5", storage: mem(), summary: slow, wait: 20 }), true);
  assert.equal(await installSafety([unknownJob], { alert: a.alert, mode: "jailbreak", ios: () => "17.5", storage: mem(), summary: async () => { throw new Error("x"); } }), true);
  assert.equal(a.seen.length, 0);
});

test("confirmUnknownSource: known-safe and piracy hosts pass; others get Add & Trust / Add Source / Cancel", async () => {
  const a = alerts();
  assert.deepEqual(await confirmUnknownSource("https://havoc.app/", { alert: a.alert }), { trust: false });
  assert.deepEqual(await confirmUnknownSource("https://repo.hackyouriphone.org/", { alert: a.alert }), { trust: false }, "Source Warning already asked");
  assert.equal(a.seen.length, 0);
  assert.deepEqual(await confirmUnknownSource("https://cool-ipas.xyz/apps.json", { alert: alerts([0]).alert }), { trust: true });
  assert.deepEqual(await confirmUnknownSource("https://cool-ipas.xyz/apps.json", { alert: alerts([1]).alert }), { trust: false });
  assert.equal(await confirmUnknownSource("https://cool-ipas.xyz/apps.json", { alert: alerts([2]).alert }), null);
});

test("lookForPatch: none listed, nothing asked; never in the sideload app", async () => {
  resetPatchAsked();
  const a = alerts();
  assert.equal(await lookForPatch({ mode: "jailbreak", ios: () => "16.2", installed: () => new Map([["x", "1"]]), alert: a.alert, storage: mem() }), null);
  assert.equal(await lookForPatch({ mode: "sideload", ios: () => "16.2", installed: () => new Map(), alert: a.alert, storage: mem() }), null);
  assert.equal(a.seen.length, 0);
});

test("patchUpgrades: the sideload app's upgrades unchanged; nothing listed keeps Changes as it was", async () => {
  const u = { available: [{ id: "a" }], ignored: [] };
  assert.equal(await patchUpgrades(u, { mode: "sideload" }), u);
  assert.equal(await patchUpgrades(u, { mode: "jailbreak", ios: () => "16.2", installed: () => new Map(), keyOf: async () => "k" }), u);
});

test("reportMalicious: a reason and the version go out; Something Else asks for words; Cancel sends nothing", async () => {
  const sent = [];
  const api = { send: async (id, body) => { sent.push([id, body]); return { ok: true, count: 1 }; } };
  const a = alerts();
  assert.equal(await reportMalicious({ id: "com.cool.gba", version: "3.0", name: "GBA4U" }, { ask: async () => 1, alert: a.alert, api, hash: () => "e".repeat(64) }), "sent");
  assert.deepEqual(sent[0], ["com.cool.gba", { reason: "data", text: "", version: "3.0", sha256: "e".repeat(64) }]);
  assert.equal(a.seen.at(-1).title, "Reported");
  assert.equal(await reportMalicious({ id: "x", version: "1" }, { ask: async () => -1, alert: a.alert, api, hash: () => null }), "cancelled");
  const other = async (spec) => (spec.input ? { index: 1, value: "it asked for my password" } : { index: 0 });
  assert.equal(await reportMalicious({ id: "x", version: "1" }, { ask: async () => 6, alert: other, api, hash: () => null }), "sent");
  assert.deepEqual(sent[1][1], { reason: "other", text: "it asked for my password", version: "1" });
  const down = { send: async () => { const e = new Error("later"); e.code = "rate_limited"; throw e; } };
  const b = alerts();
  assert.equal(await reportMalicious({ id: "x", version: "1" }, { ask: async () => 0, alert: b.alert, api: down, hash: () => null }), "failed");
  assert.match(b.seen[0].message, /Too many reports/);
});
