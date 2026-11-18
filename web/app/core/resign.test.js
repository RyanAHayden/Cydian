// F91: signature status (the pill's states), Needs Re-sign's rows, and "resign" jobs in the app queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signatureState, resignWindow, needsResign, signedIndex, signedAppRows, RESIGN_WINDOW } from "./signing.js";
import { createAppQueue, appPlan, runOrder, modifyActions, resignJob, APP_MODES, APP_MODE_LABEL, SELF_ID } from "./appqueue.js";

const now = new Date("2026-11-18T12:00:00Z");
const inDays = (d) => new Date(now.getTime() + d * 86400000).toISOString();

test("signatureState: green outside the window, amber inside it, red once expired; Expired / Today / N days", () => {
  const s = (d, window = 2) => { const r = signatureState(inDays(d), { now, window }); return [r.state, r.text, r.long]; };
  assert.deepEqual(s(5), ["ok", "5 days", "5 days left"]);
  assert.deepEqual(s(2.5), ["ok", "2 days", "2 days left"]);
  assert.deepEqual(s(2), ["soon", "2 days", "2 days left"]); // the window's edge is inside it
  assert.deepEqual(s(1.2), ["soon", "1 day", "1 day left"]);
  assert.deepEqual(s(0.3), ["soon", "Today", "Expires today"]);
  assert.deepEqual(s(-0.1), ["expired", "Expired", "Expired"]);
  assert.deepEqual(s(5, 7), ["soon", "5 days", "5 days left"]); // Re-sign Reminder: 7 Days Before
  assert.deepEqual(s(0.5, 0), ["ok", "Today", "Expires today"]); // Off: only expired apps need one
  assert.equal(signatureState(null, { now }), null);
  assert.equal(signatureState("not a date", { now }), null);
});

test("resignWindow: the resignReminder setting, 2 days without one", () => {
  assert.equal(resignWindow((k) => (k === "resignReminder" ? 7 : null)), 7);
  assert.equal(resignWindow(() => 0), 0);
  assert.equal(resignWindow(() => undefined), RESIGN_WINDOW);
  assert.equal(RESIGN_WINDOW, 2);
  assert.equal(resignWindow(null), 2);
  assert.equal(resignWindow(() => { throw new Error("x"); }), 2);
});

const installed = { apps: [
  { bundleId: "a", originalBundleId: "a.orig", name: "Alpha", version: "1.0", expires: inDays(5) },
  { bundleId: "b", name: "Bravo", version: "2.0", expires: inDays(1.5) },
  { bundleId: "c", name: "Charlie", version: "3.0", expires: inDays(-1) },
  { bundleId: "d", name: "Delta", version: "4.0", expires: null },
  { bundleId: "e", originalBundleId: "e.orig", name: "Echo", version: "5.0", expires: inDays(0.5) },
] };

test("needsResign: inside the window or expired, soonest first, the app's version kept; those with an upgrade left out", () => {
  const rows = needsResign(installed, { now, window: 2 });
  assert.deepEqual(rows.map((r) => [r.id, r.version, r.sig, r.installed]),
    [["c", "Expired", "expired", "3.0"], ["e", "Today", "soon", "5.0"], ["b", "1 day", "soon", "2.0"]]);
  assert.ok(rows.every((r) => r.change === "resign" && r.short));
  assert.deepEqual(needsResign(installed, { now, window: 2, skip: new Set(["e.orig", "b"]) }).map((r) => r.id), ["c"]);
  assert.deepEqual(needsResign(installed, { now, window: 7 }).map((r) => r.id), ["c", "e", "b", "a"]);
  assert.deepEqual(needsResign(null, { now }), []);
});

test("signedIndex: by installed and original bundle ID", () => {
  const ix = signedIndex(installed);
  assert.equal(ix.get("a").name, "Alpha");
  assert.equal(ix.get("a.orig").name, "Alpha");
  assert.equal(ix.get("zzz"), undefined);
});

test("resign jobs: queued without an IPA, their own Re-sign group, iFizBox last", () => {
  const q = createAppQueue();
  const rows = needsResign(installed, { now, window: 2 });
  const j = q.add(resignJob(rows[0]));
  assert.deepEqual([j.op, j.mode, j.id, j.version, j.url], ["resign", "resign", "c", "3.0", null]);
  q.add(resignJob({ bundleId: SELF_ID, name: "iFizBox", version: "0.3.6" }));
  q.add({ id: "x", name: "X", version: "2", installed: "1", url: "https://s/x.ipa" });
  const plan = appPlan(q.list());
  assert.deepEqual(plan.resigns, [{ id: "c", from: "3.0", to: "3.0" }, { id: SELF_ID, from: "0.3.6", to: "0.3.6" }]);
  assert.deepEqual(plan.upgrades.map((e) => e.id), ["x"]);
  assert.equal(plan.download, null); // re-signs download nothing Confirm can size
  assert.deepEqual(runOrder(q.list()).map((x) => x.id), ["c", "x", SELF_ID]);
  assert.ok(APP_MODES.includes("resign") && !APP_MODES.includes("remove"));
  assert.equal(APP_MODE_LABEL.resign, "Re-sign");
  // queuing an install of the same app replaces its re-sign, as Cydia's marks do
  q.add({ id: "c", name: "Charlie", version: "3.1", installed: "3.0", url: "https://s/c.ipa" });
  assert.equal(q.get("c").mode, "upgrade");
});

test("resignJob: from a Signed Apps row, a Needs Re-sign row or a record; none without an id", () => {
  const [row] = signedAppRows(installed, now).filter((r) => r.bundleId === "b");
  assert.deepEqual(resignJob(row), { id: "b", name: "Bravo", version: "2.0", installed: "2.0", mode: "resign", icon: null });
  assert.equal(resignJob(installed.apps[0]).version, "1.0");
  assert.equal(resignJob({}), null);
  assert.equal(resignJob(null), null);
});

test("Modify (F91): Re-sign last for an app iFizBox signed", () => {
  assert.deepEqual(modifyActions({ installed: "1", newest: "1", signed: true }), ["Reinstall", "Re-sign"]);
  assert.deepEqual(modifyActions({ installed: "1", newest: "2", older: true, signed: true }), ["Upgrade", "Downgrade", "Re-sign"]);
  assert.deepEqual(modifyActions({ queued: true, installed: "1", newest: "1", signed: true }), ["Clear", "Reinstall", "Re-sign"]);
  assert.deepEqual(modifyActions({ installed: null, newest: "1", signed: true }), ["Install", "Re-sign"]);
  assert.deepEqual(modifyActions({ installed: "1", newest: "1" }), ["Reinstall"]);
});
