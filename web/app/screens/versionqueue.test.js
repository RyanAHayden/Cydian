// F85: Version History's Install and Custom Install go through the queue like the app page's (F84): the row's
// version is the job's (altstore.js appPageAction / appPageCustom `version`), and Confirm opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appPageAction, appPageCustom } from "./altstore.js";
import { queueApp } from "./queue.js";
import { createAppQueue } from "../core/appqueue.js";

const pkg = { key: "alt:k", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
  sourceUrl: "https://s/", versions: [
    { version: "3", downloadURL: "https://s/a3.ipa", size: 3072 },
    { version: "2", downloadURL: "https://s/a2.ipa", size: 2048 },
  ] } } };
const storeWith = (version) => async () => ({ all: async () => (version ? [{ id: "com.x.a", version }] : []) });

test("Version History's Install queues that version (a downgrade here) and opens Confirm, with no Modify sheet", async () => {
  const q = createAppQueue();
  const opened = [];
  const add = (j, o) => queueApp(j, { ...o, open: (qq) => opened.push(qq) });
  const opts = { queue: q, add, mode: "sideload", ready: async () => true, store: storeWith("3"), ask: async () => assert.fail("no sheet") };
  assert.equal(await appPageAction(pkg, null, { ...opts, version: "2" }), true);
  const j = q.get("com.x.a");
  assert.equal(j.version, "2");
  assert.equal(j.url, "https://s/a2.ipa");
  assert.equal(j.mode, "downgrade");
  // Queued already: another version's Install replaces it, still with no Modify sheet.
  assert.equal(await appPageAction(pkg, null, { ...opts, version: "3" }), true);
  assert.equal(q.get("com.x.a").mode, "reinstall");
  assert.equal(q.size, 1);
  assert.equal(opened.length, 2);
});

test("Version History's Custom Install queues that version with its options", async () => {
  const q = createAppQueue();
  const add = (j, o) => queueApp(j, { ...o, open: () => {} });
  let url = null;
  const custom = async (o) => { url = o.url; o.queue({ token: "t", at: 1, edits: { name: "Mine" }, name: "Mine", signsAs: null }); return true; };
  await appPageCustom(pkg, null, { name: "A" }, { queue: q, add, mode: "sideload", store: storeWith(null), custom, version: "2" });
  assert.equal(url, "https://s/a2.ipa");
  assert.equal(q.get("com.x.a").version, "2");
  assert.equal(q.get("com.x.a").options.edits.name, "Mine");
});

test("No queue (the jailbreak build, no certificate) leaves the version to the old path", async () => {
  const q = createAppQueue();
  assert.equal(await appPageAction(pkg, null, { queue: q, mode: "jailbreak", version: "2" }), false);
  assert.equal(await appPageAction(pkg, null, { queue: q, mode: "web", ready: async () => false, store: storeWith(null), version: "2" }), false);
  assert.equal(q.size, 0);
});
