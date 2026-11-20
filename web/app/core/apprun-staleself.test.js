// B159: iFizBox's own upgrade must install the version it offered: a signed IPA that isn't newer than the running
// iFizBox (the source's older IPA, while GitHub's release offered the newer one) fails its row, is never handed to
// iOS, and its signed copy is freed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, rowStatus, staleSelf } from "./apprun.js";
import { SELF_ID } from "./appqueue.js";

const selfJob = (o = {}) => ({ id: SELF_ID, name: "iFizBox", mode: "upgrade", version: "0.13.0", installed: "0.12.0", url: "https://x/i.ipa", ...o });
const rowOf = (job) => appRows([job])[0];

test("staleSelf: only iFizBox's upgrade whose IPA isn't newer than the running app", () => {
  assert.match(staleSelf(rowOf(selfJob()), { version: "0.12.0" }), /iFizBox 0\.12\.0, not newer than this iFizBox 0\.12\.0 \(0\.13\.0 was offered\)/);
  assert.ok(staleSelf(rowOf(selfJob()), { version: "0.11.9" }), "older still");
  assert.equal(staleSelf(rowOf(selfJob()), { version: "0.13.0" }), null, "the offered one");
  assert.equal(staleSelf(rowOf(selfJob()), { version: "0.12.1" }), null, "any newer one");
  assert.equal(staleSelf(rowOf(selfJob()), {}), null, "no version to compare (an older shell)");
  assert.equal(staleSelf(rowOf(selfJob({ mode: "resign" })), { version: "0.12.0" }), null, "a re-sign is the same version");
  assert.equal(staleSelf(rowOf(selfJob({ version: "0.12.0" })), { version: "0.12.0" }), null, "a reinstall offered nothing newer");
  assert.equal(staleSelf(rowOf(selfJob({ installed: null })), { version: "0.12.0" }), null, "not on the phone: nothing to compare");
  assert.equal(staleSelf(rowOf(selfJob({ id: "com.other" })), { version: "0.12.0" }), null, "another app");
});

test("the run: a stale self IPA fails its row before iOS, and its signed copy is discarded", async () => {
  const rows = appRows([selfJob()]);
  const installs = [], discards = [];
  const run = createAppRun({ rows, sign: async () => ({ token: "t1", bundleId: SELF_ID, version: "0.12.0" }),
    install: async (r) => { installs.push(r.id); return { installed: true }; }, discard: (r) => discards.push(r.token) });
  await run.start();
  assert.deepEqual(installs, []);
  assert.deepEqual(discards, ["t1"]);
  assert.equal(rows[0].state, "failed");
  assert.match(rowStatus(rows[0]), /^Failed: the downloaded IPA is iFizBox 0\.12\.0, not newer/);
});

test("the run: the offered version goes to iOS as before", async () => {
  const rows = appRows([selfJob()]);
  const installs = [];
  const run = createAppRun({ rows, sign: async () => ({ token: "t1", bundleId: SELF_ID, version: "0.13.0" }),
    install: async (r) => { installs.push(r.id); return { installed: true }; }, discard: () => {} });
  await run.start();
  assert.deepEqual(installs, [SELF_ID]);
  assert.equal(rows[0].state, "installed");
});
