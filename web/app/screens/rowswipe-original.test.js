// F249: an app row's swipe and hold-menu Install (sideload app) ask F243's original-app question before the job goes
// in, as the app page does (altstore.js queueOriginalCheck): Cancel queues nothing, Install a Copy queues
// keepBundleId: false; an Upgrade (a record exists) is never asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRowQueueJob } from "./browse.js";
import { queueOriginalCheck } from "./altstore.js";

const job = { id: "com.x.app", name: "App", version: "2.0", installed: null, url: "https://s/app.ipa" };
const checkWith = (answer, asked) => ({ check: (j) => queueOriginalCheck(j, async (o) => { asked.push(o); return answer; }) });

test("a fresh install from a row asks once and follows the answer", async () => {
  const asked = [];
  assert.equal(await appRowQueueJob(job, null, checkWith("cancel", asked)), null);
  assert.deepEqual(asked, [{ bundleId: "com.x.app", name: "App" }]);
  assert.deepEqual((await appRowQueueJob(job, null, checkWith("copy", []))).options, { edits: { keepBundleId: false } });
  assert.equal(await appRowQueueJob(job, null, checkWith("install", [])), job);
});

test("an upgrade from a row, or no job, is not asked", async () => {
  const asked = [];
  assert.equal(await appRowQueueJob(job, "1.0", checkWith("cancel", asked)), job);
  assert.equal(await appRowQueueJob(job, "", checkWith("cancel", asked)), job);
  assert.equal(await appRowQueueJob(null, null, checkWith("cancel", asked)), null);
  assert.deepEqual(asked, []);
});
