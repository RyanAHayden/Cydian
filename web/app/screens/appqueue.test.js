// F80: the sideload app's queue screens: queuing opens Confirm, Confirm's run (screens/queue.js), and the app page's
// Install / Modify (altstore.js appPageAction).
import { test } from "node:test";
import assert from "node:assert/strict";
import { queueApp, runAppQueue } from "./queue.js";
import { appPageAction } from "./altstore.js";
import { createAppQueue, appNavLabel, SELF_ID } from "../core/appqueue.js";

const job = (id, extra = {}) => ({ id, name: id.toUpperCase(), version: "2", url: `https://x/${id}.ipa`, ...extra });

test("queueApp: queues the app and opens Confirm over the queue", () => {
  const q = createAppQueue();
  const opened = [];
  queueApp(job("a"), { queue: q, open: (qq) => opened.push(qq) });
  queueApp(job("b"), { queue: q, open: (qq) => opened.push(qq) });
  assert.deepEqual(q.list().map((j) => j.id), ["a", "b"]);
  assert.equal(opened.length, 2); // the second redraws the open sheet (openAppConfirm refreshes when one is up)
  assert.equal(opened[0], q);
});

test("Confirm's run: each app in turn, iFizBox last, each cleared and recorded; a failure stops it and keeps the rest", async () => {
  const q = createAppQueue();
  for (const j of [job(SELF_ID), job("a"), job("b")]) q.add(j);
  const seen = [], recorded = [];
  const n = await runAppQueue(q.list(), { queue: q, ready: async () => true, install: async (j) => { seen.push(j.id); return true; },
    record: async (j) => recorded.push(j.id) });
  assert.equal(n, 3);
  assert.deepEqual(seen, ["a", "b", SELF_ID]);
  assert.deepEqual(recorded, ["a", "b", SELF_ID]); // recordApp itself leaves iFizBox to its own record
  assert.equal(q.size, 0);

  for (const j of [job("a"), job("b")]) q.add(j);
  seen.length = 0;
  assert.equal(await runAppQueue(q.list(), { queue: q, ready: async () => true, record: async () => {},
    install: async (j) => { seen.push(j.id); return j.id !== "a"; } }), 0);
  assert.deepEqual(seen, ["a"]);
  assert.deepEqual(q.list().map((j) => j.id), ["a", "b"]);

  // The Signing walkthrough opened instead (nothing to sign with yet): nothing runs, the queue stays.
  assert.equal(await runAppQueue(q.list(), { queue: q, ready: async () => false, install: async () => assert.fail("ran") }), 0);
  // A thrown install counts as a failure.
  assert.equal(await runAppQueue(q.list(), { queue: q, ready: async () => true, install: async () => { throw new Error("x"); } }), 0);
  assert.equal(q.size, 2);
});

test("app page (F80): installed, Modify's sheet offers Upgrade (and Downgrade); queued, Clear or queue again", async () => {
  const pkg = { key: "alt:k", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
    sourceUrl: "https://s/", versions: [{ version: "2", downloadURL: "https://s/a.ipa" }] } } };
  const q = createAppQueue();
  const store = async () => ({ all: async () => [{ id: "com.x.a", version: "1" }] });
  const added = [];
  const add = (j, o) => { added.push(j); o.queue.add(j); };
  const base = { queue: q, add, mode: "sideload", ready: async () => true, store };
  let sheet = null;
  assert.equal(await appPageAction(pkg, null, { ...base, ask: async (o) => { sheet = o; return 0; } }), true);
  assert.deepEqual(sheet.buttons, ["Upgrade", "Mark as Not Installed"]); // F94: then Mark as Not Installed; installed 1, newest 2: Modify offers Upgrade
  assert.equal(q.get("com.x.a").mode, "upgrade");
  assert.equal(appNavLabel({ queued: Boolean(q.get("com.x.a")), installed: "1", newest: "2" }), "Modify");

  let asked = null;
  assert.equal(await appPageAction(pkg, null, { ...base, ask: async (o) => { asked = o; return 1; } }), true);
  assert.deepEqual(asked.buttons, ["Clear", "Upgrade", "Mark as Not Installed"]);
  assert.equal(added.length, 2); // Upgrade: queued again, Confirm opens
  assert.equal(await appPageAction(pkg, null, { ...base, ask: async () => 0 }), true);
  assert.equal(q.size, 0); // Clear
  assert.equal(await appPageAction(pkg, null, { ...base, ask: async () => -1 }), true); // Cancel: nothing queued
  assert.equal(q.size, 0);
  // An older version on the source: Downgrade, then which version
  const two = { ...pkg, stanza: { ...pkg.stanza, ipa: { ...pkg.stanza.ipa, versions: [{ version: "2", downloadURL: "https://s/a2.ipa" }, { version: "0.9", downloadURL: "https://s/a09.ipa" }] } } };
  const answers = [1, 0];
  const seen = [];
  await appPageAction(two, null, { ...base, ask: async (o) => { seen.push(o.buttons); return answers.shift(); } });
  assert.deepEqual(seen, [["Upgrade", "Downgrade", "Mark as Not Installed"], ["0.9"]]);
  assert.equal(q.get("com.x.a").version, "0.9");
  q.clearAll();

  // Where the queue doesn't apply, the page does what it did before.
  assert.equal(await appPageAction(pkg, null, { ...base, mode: "jailbreak" }), false);
  assert.equal(await appPageAction(pkg, null, { ...base, mode: "site", ask: async () => 0 }), false); // F94: Upgrade: the page installs it
  assert.equal(await appPageAction(pkg, null, { ...base, ready: async () => false }), false);
  const itms = { ...pkg, stanza: { ...pkg.stanza, ipa: { ...pkg.stanza.ipa, versions: [{ version: "2", downloadURL: "itms-services://?x" }] } } };
  assert.equal(await appPageAction(itms, null, base), false);
});
