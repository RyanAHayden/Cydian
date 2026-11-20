// B170: the core of "a cancelled or unconfirmed install is never recorded": recordWhen per path, run.unconfirm (iOS no
// longer has a confirmed app) and undoRecord (core/installed.js: the record a run replaced comes back).
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordWhen, appRows, createAppRun } from "./apprun.js";
import { memoryAppStore, recordInstall, undoRecord } from "./installed.js";

const row = (o = {}) => ({ id: "com.a", bundleId: "com.a", mode: "install", state: "installed", unsure: true, ...o });

test("B170: recordWhen: cancelled never; Sent to iOS waits unless iOS said true", () => {
  assert.equal(recordWhen(row({ state: "cancelled", unsure: false }), true), "never");
  assert.equal(recordWhen(row({ state: "failed", dismissed: true }), true), "never");
  for (const v of [undefined, null, false]) assert.equal(recordWhen(row(), v), "wait");
  assert.equal(recordWhen(row(), true), "now");
  assert.equal(recordWhen(row({ bundleId: null }), null), "wait");
  assert.equal(recordWhen(row({ unsure: false })), "now");
});

test("B170: run.unconfirm turns a confirmed install back to Sent to iOS, only for installs", async () => {
  const rows = appRows([{ id: "com.a", name: "A", mode: "install" }, { id: "com.b", name: "B", mode: "resign" }]);
  const lines = [];
  const run = createAppRun({ rows, sign: async () => ({}), install: async () => ({}), onLog: (l) => lines.push(l.text) });
  Object.assign(rows[0], { state: "installed", unsure: true, bundleId: "com.a" });
  Object.assign(rows[1], { state: "installed", unsure: false });
  assert.equal(run.unconfirm("com.a"), false, "not confirmed yet");
  assert.equal(run.confirm("com.a"), true);
  assert.equal(run.unconfirm("com.a"), true);
  assert.equal(rows[0].unsure, true);
  assert.equal(lines.at(-1), "iOS doesn't have A now");
  assert.equal(run.unconfirm("com.b"), false, "a re-sign has nothing to undo");
  assert.equal(run.unconfirm("nope"), false);
});

test("B170: undoRecord puts the replaced record back, removes a new one, and leaves a record changed since", async () => {
  const s = memoryAppStore();
  const before = await recordInstall(s, { id: "a", version: "0.9" }, 1);
  const wrote = await recordInstall(s, { id: "a", version: "1.0" }, 2);
  assert.equal(await undoRecord(s, "a", before, wrote), true);
  assert.deepEqual((await s.all()).map((r) => r.version), ["0.9"]);
  const fresh = await recordInstall(s, { id: "b", version: "2.0" }, 3);
  assert.equal(await undoRecord(s, "b", null, fresh), true);
  assert.equal((await s.all()).some((r) => r.id === "b"), false);
  const w = await recordInstall(s, { id: "c", version: "1.0" }, 4);
  await recordInstall(s, { id: "c", version: "1.1" }, 5); // recorded again since
  assert.equal(await undoRecord(s, "c", null, w), false);
  assert.equal((await s.all()).find((r) => r.id === "c").version, "1.1");
  assert.equal(await undoRecord(s, "", null), false);
});
