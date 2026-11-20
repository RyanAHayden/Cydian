// B136: a failed install must not leave the app recorded as installed. recordWhen (core/apprun.js) says when a run's
// row goes into Installed's record; installedOnPhone (core/appqueue.js) lets the phone's app list overrule a record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordWhen } from "./apprun.js";
import { installedOnPhone, SELF_ID } from "./appqueue.js";

const row = (o = {}) => ({ id: "io.github.fizl0.openmx", bundleId: "io.github.fizl0.openmx", mode: "install", state: "installed",
  unsure: false, ...o });

test("B136: recordWhen: a confirmed install now; Sent to iOS waits for iOS; failed rows never", () => {
  assert.equal(recordWhen(row()), "now");
  // Sent to iOS (B76's handoff): not asked yet, or iOS says it doesn't have it (B128: iOS never fetched the IPA)
  assert.equal(recordWhen(row({ unsure: true })), "wait");
  assert.equal(recordWhen(row({ unsure: true }), false), "wait");
  // iOS has it; B170: no answer (null) or nothing to ask about (no bundle ID) waits
  assert.equal(recordWhen(row({ unsure: true }), true), "now");
  assert.equal(recordWhen(row({ unsure: true }), null), "wait");
  assert.equal(recordWhen(row({ unsure: true, bundleId: null }), true), "wait");
  // rows that change no install record
  assert.equal(recordWhen(row({ unsure: true, mode: "resign" })), "now");
  assert.equal(recordWhen(row({ unsure: true, id: SELF_ID, bundleId: SELF_ID })), "now");
  for (const state of ["failed", "cancelled", "asking", "waiting"]) assert.equal(recordWhen(row({ state }), true), "never");
  assert.equal(recordWhen(null), "never");
});

test("B136: installedOnPhone: the phone's app list overrules a stale record", () => {
  const rec = { id: "io.github.fizl0.openmx", version: "1.2" };
  assert.equal(installedOnPhone(null, true), null);
  assert.equal(installedOnPhone(rec, undefined), "1.2");
  assert.equal(installedOnPhone(rec, null), "1.2"); // iOS can't be asked: the record stands
  assert.equal(installedOnPhone(rec, true), "1.2");
  assert.equal(installedOnPhone(rec, false), null); // the failed install's record doesn't count
  assert.equal(installedOnPhone({ id: "x", version: "" }, true), "");
  assert.equal(installedOnPhone({ id: SELF_ID, version: "1.0", self: true }, false), "1.0");
});
