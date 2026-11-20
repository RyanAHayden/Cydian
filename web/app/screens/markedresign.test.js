// F221: Re-sign for apps marked as installed (no signature record of iFizBox's): offered while the installed version
// is on its source (sideload app, website; not the jailbreak build), queued as a resign job with that version's IPA,
// which Confirm's run downloads and signs (signing.install), and the Installed list's grey "?" pill.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appPageAction } from "./altstore.js";
import { resignApp } from "./queue.js";
import { withSignatures, markedSubtitle, MARKED_SIG } from "./installed.js";
import { createAppQueue, modifyActions, markedResignJob, markedVersionOnSource, appPlan, MARK_NOT_INSTALLED } from "../core/appqueue.js";
import { memoryAppStore } from "../core/installed.js";
import * as sc from "../signing-client.js";

const pkg = (versions) => ({ key: "alt:k", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
  sourceUrl: "https://s/", iconURL: "https://s/a.png", versions } } });
const A = pkg([{ version: "2", downloadURL: "https://s/a2.ipa", size: 2048 }, { version: "1", downloadURL: "https://s/a1.ipa" }]);

test("modifyActions: a marked app re-signs when its version is on the source, in the sideload app and the website only", () => {
  for (const build of ["sideload", "site"]) {
    assert.deepEqual(modifyActions({ installed: "2", newest: "2", onSource: true, build }), ["Reinstall", "Re-sign", MARK_NOT_INSTALLED]);
    assert.deepEqual(modifyActions({ installed: "1", newest: "2", onSource: false, build }), ["Upgrade", MARK_NOT_INSTALLED]);
    assert.deepEqual(modifyActions({ installed: "", newest: "2", onSource: true, build }), ["Reinstall", MARK_NOT_INSTALLED]); // version unknown
    assert.deepEqual(modifyActions({ installed: "2", newest: "2", signed: true, onSource: true, build }), ["Reinstall", "Re-sign", MARK_NOT_INSTALLED]); // once
    assert.deepEqual(modifyActions({ queued: true, installed: "2", newest: "2", onSource: true, build }), ["Clear", "Reinstall", "Re-sign", MARK_NOT_INSTALLED]);
  }
  assert.deepEqual(modifyActions({ installed: "2", newest: "2", onSource: true, build: "jailbreak" }), ["Reinstall", "Remove"]); // unchanged
  assert.deepEqual(modifyActions({ installed: null, newest: "2", onSource: true, build: "sideload" }), ["Install"]);
});

test("markedVersionOnSource / markedResignJob: the installed version's IPA, or null", () => {
  assert.equal(markedVersionOnSource(A, "1").downloadURL, "https://s/a1.ipa");
  assert.equal(markedVersionOnSource(A, "3"), null);
  assert.equal(markedVersionOnSource(A, ""), null);
  assert.equal(markedVersionOnSource(pkg([{ version: "1", downloadURL: "itms-services://?action=download-manifest&url=https://s/m.plist" }]), "1"), null);
  const j = markedResignJob(A, "2", { source: "S" });
  assert.deepEqual([j.id, j.mode, j.version, j.installed, j.url, j.sourceName], ["com.x.a", "resign", "2", "2", "https://s/a2.ipa", "S"]);
  assert.equal(markedResignJob(A, "3"), null);
  // the queue keeps its url, and Confirm lists it under Re-sign
  const q = createAppQueue();
  const job = q.add(j);
  assert.deepEqual([job.op, job.mode, job.url, job.size], ["resign", "resign", "https://s/a2.ipa", 2048]);
  assert.deepEqual(appPlan(q.list()).resigns, [{ id: "com.x.a", from: "2", to: "2" }]);
  assert.equal(q.add({ id: "r", mode: "resign", version: "1" }).url, null); // F91's record re-sign: still no url
});

test("sideload app page: Re-sign on a marked app queues the installed version's IPA; not offered once it left the source", async () => {
  const q = createAppQueue();
  let sheet = null;
  const base = { queue: q, mode: "sideload", ready: async () => true, signedOf: async () => null, add: (j, o) => o.queue.add(j), iv: null };
  const marked = memoryAppStore([{ id: "com.x.a", version: "1" }]);
  assert.equal(await appPageAction(A, null, { ...base, store: async () => marked, ask: async (o) => { sheet = o; return o.buttons.indexOf("Re-sign"); } }), true);
  assert.deepEqual(sheet.buttons, ["Upgrade", "Re-sign", MARK_NOT_INSTALLED]);
  assert.deepEqual([q.get("com.x.a").mode, q.get("com.x.a").version, q.get("com.x.a").url], ["resign", "1", "https://s/a1.ipa"]);
  q.clearAll();
  const gone = memoryAppStore([{ id: "com.x.a", version: "0.9" }]);
  await appPageAction(A, null, { ...base, store: async () => gone, ask: async (o) => { sheet = o; return -1; } });
  assert.ok(!sheet.buttons.includes("Re-sign"));
});

test("website: Re-sign on a marked app signs the installed version in the browser", async () => {
  const mem = memoryAppStore([{ id: "com.x.a", version: "1" }]);
  const got = [];
  let sheet = null;
  assert.equal(await appPageAction(A, null, { mode: "site", store: async () => mem, forget: async () => assert.fail("forgot"), iv: null,
    siteInstall: async (p, v) => got.push(v.downloadURL), ask: async (o) => { sheet = o; return o.buttons.indexOf("Re-sign"); } }), true);
  assert.deepEqual(sheet.buttons, ["Upgrade", "Re-sign", MARK_NOT_INSTALLED]);
  assert.deepEqual(got, ["https://s/a1.ipa"]);
});

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("Confirm's run: a marked app's resign job downloads its source IPA through signing.install, not signing.resign", async () => {
  const calls = [];
  const n = { mode: "sideload", call: async (m, p) => { calls.push([m, p]); return m === "signing.install" ? { bundleId: "com.x.a", name: "A" } : null; } };
  globalThis.ifizboxNative = n; // the sideload build (signing-client localSigning)
  const ui = { labels: [] };
  const deps = { native: n, hud: (t) => { ui.labels.push(t); return { set: (x) => ui.labels.push(x), hide: () => {} }; },
    alert: async () => assert.fail("alert"), later: () => {}, follow: () => {} };
  const job = createAppQueue().add(markedResignJob(A, "1"));
  assert.equal(await resignApp(job, { sc, native: n, deps }), true);
  assert.deepEqual(calls.map((c) => c[0]), ["signing.install"]);
  assert.equal(calls[0][1].url, "https://s/a1.ipa");
  assert.equal(ui.labels[0], "Downloading");
});

test("Installed: a marked app's grey ? pill and its subtitle; signed apps keep their days", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const rows = [{ id: "a", name: "A", version: "1" }, { id: "m", name: "M", version: "3" }, { id: "self", name: "Me", version: "9", self: true },
    { id: "gone", name: "G", version: "1", actual: null }];
  const signed = { apps: [{ bundleId: "a", version: "1", expires: new Date(now.getTime() + 5 * 86400000).toISOString() }] };
  const r = withSignatures(rows, signed, { now, window: 2, marked: true });
  assert.deepEqual(r.rows.map((x) => [x.id, x.sig?.text ?? null, Boolean(x.marked)]),
    [["a", "5 days", false], ["m", "?", true], ["self", null, false], ["gone", null, false]]);
  assert.equal(r.rows[1].sig, MARKED_SIG);
  assert.equal(MARKED_SIG.state, "unknown");
  assert.equal(withSignatures(rows, signed, { now, window: 2 }).rows[1].sig, undefined); // not asked for: as before
  assert.equal(withSignatures(rows, signed, { now, window: 2, marked: true, show: false }).rows[1].sig, undefined); // Show Expiry Dates off
  assert.equal(markedSubtitle({ version: "3" }), "Version 3 · Marked as installed");
  assert.equal(markedSubtitle({ version: "" }), "Marked as installed");
});
