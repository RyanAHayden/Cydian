// F84: Install and Custom Install through the queue. The app page's Install queues the app with no look-first sheet
// and opens Confirm (altstore.js appPageAction, F80); Custom Install's sheet queues it with its options
// (altstore.js appPageCustom, signing-sheet.js inspectToQueue), kept per job (core/appqueue.js options), and
// Confirm's run signs each with its own (screens/queue.js installCustom, core/appqueue.js customParams).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appPageAction, appPageCustom } from "./altstore.js";
import { queueApp, runAppQueue, installCustom } from "./queue.js";
import { createAppQueue, customParams, TOKEN_LIFE } from "../core/appqueue.js";
import { customInstall, inspectToQueue } from "../signing-sheet.js";

const pkgOf = (id, v = "2") => ({ key: "alt:k", row: { id, name: id }, stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: id.toUpperCase(),
  sourceUrl: "https://s/", versions: [{ version: v, downloadURL: `https://s/${id}.ipa`, size: 2048 }] } } });
const noStore = async () => ({ all: async () => [] });

test("Install queues the app and opens Confirm, with no sheet first", async () => {
  const q = createAppQueue();
  const opened = [];
  const add = (j, o) => queueApp(j, { ...o, open: (qq) => opened.push(qq) });
  assert.equal(await appPageAction(pkgOf("com.x.a"), null, { queue: q, add, mode: "sideload", ready: async () => true, store: noStore,
    ask: async () => assert.fail("no look-first sheet") }), true);
  assert.equal(q.get("com.x.a").options, null);
  assert.deepEqual(opened, [q]);
});

test("Custom Install: the sheet's Install queues the app with its options and opens Confirm; options stay per job", async () => {
  const q = createAppQueue();
  const opened = [];
  const add = (j, o) => queueApp(j, { ...o, open: (qq) => opened.push(qq) });
  const opts = (edits, token) => ({ token, at: 1000, edits, name: edits.name ?? null, signsAs: edits.bundleId ?? null });
  // `custom` stands in for signing-sheet.js customInstall: it gets a queue callback and calls it as the sheet's Install would.
  const custom = (edits, token) => async (o) => { assert.equal(typeof o.queue, "function"); o.queue(opts(edits, token)); return true; };
  await appPageCustom(pkgOf("com.x.a"), null, { name: "A" }, { queue: q, add, mode: "sideload", store: noStore,
    custom: custom({ name: "Mine", bundleId: "com.me.a" }, "t1") });
  await appPageCustom(pkgOf("com.x.b"), null, { name: "B" }, { queue: q, add, mode: "sideload", store: noStore,
    custom: custom({ removeExtensions: ["PlugIns/W.appex"] }, "t2") });
  q.add({ id: "com.x.c", url: "https://s/c.ipa" }); // a plain Install beside them
  assert.equal(opened.length, 2);
  assert.equal(q.get("com.x.a").options.edits.bundleId, "com.me.a");
  assert.deepEqual(q.get("com.x.b").options.edits, { removeExtensions: ["PlugIns/W.appex"] });
  assert.equal(q.get("com.x.c").options, null);

  // Confirm's run: each in turn, each with its own options.
  const calls = [];
  const sc = { isSelfIpa: () => false, installOnDevice: async (o) => { calls.push(o); return true; } };
  const n = await runAppQueue(q.list(), { queue: q, ready: async () => true, record: async () => {},
    install: (j) => (j.options ? installCustom(j, { sc, now: 2000, follow: () => {} }) : sc.installOnDevice({ url: j.url })) });
  assert.equal(n, 3);
  assert.deepEqual(calls.map((c) => c.params ?? null), [
    { token: "t1", name: "Mine", bundleId: "com.me.a" },
    { token: "t2", removeExtensions: ["PlugIns/W.appex"] },
    null,
  ]);
  assert.equal(calls[0].name, "Mine");
  assert.equal(q.size, 0);
});

test("Custom Install outside the sideload app (or with no IPA to queue) signs straight away", async () => {
  let got = null;
  await appPageCustom(pkgOf("com.x.a"), null, { url: "u", name: "A" }, { mode: "web", store: noStore, custom: async (o) => { got = o; } });
  assert.deepEqual(got, { url: "u", name: "A" });
});

test("customParams: the token while fresh, then the url; a spent token isn't sent again", async () => {
  const job = { id: "a", url: "https://s/a.ipa", options: { token: "t", at: 0, edits: { name: "N" } } };
  assert.deepEqual(customParams(job, TOKEN_LIFE - 1), { token: "t", name: "N" });
  assert.deepEqual(customParams(job, TOKEN_LIFE), { url: "https://s/a.ipa", name: "N" });
  assert.equal(customParams({ id: "a", url: "x" }), null);
  const sc = { isSelfIpa: () => false, installOnDevice: async (o) => { sc.last = o; return false; } };
  await installCustom(job, { sc, now: 1, follow: () => {} });
  assert.equal(sc.last.params.token, "t");
  await installCustom(job, { sc, now: 2, follow: () => {} }); // the failed run kept it queued: download again
  assert.deepEqual(sc.last.params, { url: "https://s/a.ipa", name: "N" });
});

test("customInstall with a queue opens the queuing sheet; inspectToQueue hands over the edits and the token", async () => {
  let which = null;
  await customInstall({ url: "u", queue: () => {} }, { check: async () => false, inspect: async () => { which = "now"; }, toQueue: async () => { which = "queue"; } });
  assert.equal(which, "queue");
  await customInstall({ url: "u" }, { check: async () => false, inspect: async () => { which = "now"; }, toQueue: async () => { which = "queue"; } });
  assert.equal(which, "now");

  const info = { token: "tok", app: { name: "App", bundleId: "com.x.a", extensions: [{ path: "PlugIns/W.appex" }] }, signsAs: "com.x.a" };
  const native = { call: async (m) => { assert.equal(m, "signing.inspect"); return info; } };
  const hud = () => ({ set() {}, hide() {} });
  let queued = null;
  const r = await inspectToQueue({ url: "u", name: "App", queue: (o) => { queued = o; } }, { native, hud, now: () => 42,
    sheet: (_info, h) => { setTimeout(() => h.onSign({ name: "Mine", bundleId: "com.me.a", icon: null, removeExtensions: ["PlugIns/W.appex"] })); return () => {}; } });
  assert.equal(r, true);
  assert.deepEqual(queued, { token: "tok", at: 42, edits: { name: "Mine", bundleId: "com.me.a", removeExtensions: ["PlugIns/W.appex"] },
    name: "Mine", signsAs: "com.me.a" });

  // Cancel: nothing queued.
  queued = null;
  const c = await inspectToQueue({ url: "u", queue: (o) => { queued = o; } }, { native, hud,
    sheet: (_info, h) => { setTimeout(() => h.onClose()); return () => {}; } });
  assert.equal(c, false);
  assert.equal(queued, null);
});
