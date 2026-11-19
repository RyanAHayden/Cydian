// F241: My IPAs' Install through the IPA queue's run: an entry becomes a library job (core/appqueue.js libraryJob,
// add({ library })), the run signs it with signing.prepare {library, ...its Sign Options}, and the IPA page's Install
// queues it while the Signing Server answers; offline it falls back to today's sign-and-keep (installFromLibrary).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppQueue, libraryJob, appPlan } from "../core/appqueue.js";
import { prepareParams, prepareOnDevice } from "../signing-client.js";
import { queueLibraryInstall } from "./myipas.js";

const DELTA = { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 1000, icon: "iVBOR", signed: null };
const ALPHA = { file: "Alpha.ipa", name: "Alpha", bundleId: "com.x.alpha", version: "2.0", size: 2000, icon: null,
  options: { name: "My Alpha", bundleId: "com.me.alpha", icon: "", removeExtensions: ["PlugIns/W.appex"], fixArm64e: true } };

test("libraryJob: the file, the bundle ID it installs as, its Sign Options as edits, My IPAs as the source", () => {
  const d = libraryJob(DELTA);
  assert.equal(d.id, "com.x.delta");
  assert.equal(d.library, "Delta.ipa");
  assert.equal(d.name, "Delta");
  assert.equal(d.installed, null);
  assert.equal(d.icon, "data:image/png;base64,iVBOR");
  assert.equal(d.sourceName, "My IPAs");
  assert.equal(d.options, null);
  const a = libraryJob(ALPHA, { installed: true });
  assert.equal(a.id, "com.me.alpha");
  assert.equal(a.name, "My Alpha");
  assert.equal(a.installed, "2.0");
  assert.deepEqual(a.options.edits, { name: "My Alpha", bundleId: "com.me.alpha", removeExtensions: ["PlugIns/W.appex"], fixArm64e: true });
  assert.equal(libraryJob({ file: "Broken.ipa", error: "not a zip" }), null);
  assert.equal(libraryJob(null), null);
  assert.equal(libraryJob({ file: "NoId.ipa" }).id, "library:NoId.ipa");
});

test("add({ library }): an install job with no url; Confirm groups it as Install or Reinstall", () => {
  const q = createAppQueue();
  const d = q.add(libraryJob(DELTA));
  assert.equal(d.op, "install");
  assert.equal(d.url, null);
  assert.equal(d.library, "Delta.ipa");
  assert.equal(d.mode, "install");
  assert.equal(q.add(libraryJob(ALPHA, { installed: true })).mode, "reinstall");
  const plan = appPlan(q.list());
  assert.deepEqual(plan.installs.map((x) => x.id), ["com.x.delta"]);
  assert.deepEqual(plan.reinstalls.map((x) => x.id), ["com.me.alpha"]);
  assert.throws(() => q.add({ id: "x" }), /no IPA/);
  assert.equal(q.add({ id: "y", url: "https://a/y.ipa" }).library, undefined);
});

test("the run signs a library job from its file: signing.prepare {library, edits, tag}", async () => {
  assert.deepEqual(prepareParams(libraryJob(DELTA)), { library: "Delta.ipa" });
  assert.deepEqual(prepareParams(createAppQueue().add(libraryJob(ALPHA))),
    { library: "Alpha.ipa", name: "My Alpha", bundleId: "com.me.alpha", removeExtensions: ["PlugIns/W.appex"], fixArm64e: true });
  const calls = [];
  const native = { call: async (method, params, onEvent) => {
    calls.push({ method, params });
    onEvent?.({ phase: "signing", progress: 0.5 });
    return { token: "t1", bundleId: "com.me.alpha", name: "My Alpha" };
  } };
  const seen = [];
  const r = await prepareOnDevice(libraryJob(ALPHA), { tag: "com.me.alpha#1", native, progress: (p, f) => seen.push([p, f]) });
  assert.equal(r.token, "t1");
  assert.equal(calls[0].method, "signing.prepare");
  assert.equal(calls[0].params.library, "Alpha.ipa");
  assert.equal(calls[0].params.url, undefined);
  assert.equal(calls[0].params.tag, "com.me.alpha#1");
  assert.deepEqual(seen, [["signing", 0.5]]);
});

test("the IPA page's Install queues the entry while the Signing Server answers, and not offline", async () => {
  const added = [];
  assert.equal(await queueLibraryInstall(DELTA, { reachable: async () => true, add: (j) => added.push(j), installed: {} }), true);
  assert.equal(added[0].library, "Delta.ipa");
  assert.equal(added[0].installed, null);
  assert.equal(await queueLibraryInstall(ALPHA, { reachable: async () => true, add: (j) => added.push(j), installed: { "com.me.alpha": true } }), true);
  assert.equal(added[1].installed, "2.0");
  // offline: nothing queued, Install signs and keeps the copy with the No Connection message (installFromLibrary)
  assert.equal(await queueLibraryInstall(DELTA, { reachable: async () => false, add: () => assert.fail("queued offline") }), false);
  assert.equal(await queueLibraryInstall(DELTA, { reachable: async () => { throw new Error("x"); }, add: () => assert.fail("queued") }), false);
  // an unknown or unreadable entry isn't queued
  assert.equal(await queueLibraryInstall(undefined, { reachable: async () => true, add: () => assert.fail("queued") }), false);
  assert.equal(await queueLibraryInstall({ file: "B.ipa", error: "bad" }, { reachable: async () => true, add: () => assert.fail("queued") }), false);
});
