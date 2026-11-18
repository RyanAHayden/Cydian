// F94: Modify's sheet offers Mark as Not Installed where the phone can't remove apps (the sideload app, the website);
// the jailbreak build keeps Remove. Picking it forgets the app's record (core/installed.js removeInstall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appPageAction } from "./altstore.js";
import { createAppQueue, modifyActions, destructiveOf, MARK_NOT_INSTALLED } from "../core/appqueue.js";
import { memoryAppStore, removeInstall } from "../core/installed.js";

test("modifyActions per build: Mark as Not Installed last (sideload, site), Remove (jailbreak), only when installed", () => {
  for (const build of ["sideload", "site"]) {
    assert.deepEqual(modifyActions({ installed: "1", newest: "2", older: true, signed: true, build }), ["Upgrade", "Downgrade", "Re-sign", MARK_NOT_INSTALLED]);
    assert.deepEqual(modifyActions({ installed: "2", newest: "2", build }), ["Reinstall", MARK_NOT_INSTALLED]);
    assert.deepEqual(modifyActions({ installed: "", newest: "2", build }), ["Reinstall", MARK_NOT_INSTALLED]); // marked, version unknown
    assert.deepEqual(modifyActions({ queued: true, installed: "1", newest: "1", build }), ["Clear", "Reinstall", MARK_NOT_INSTALLED]);
    assert.deepEqual(modifyActions({ installed: null, newest: "1", signed: true, build }), ["Install", "Re-sign"]); // not installed: nothing to forget
    assert.deepEqual(modifyActions({ queued: true, build }), ["Clear", "Install"]);
  }
  assert.deepEqual(modifyActions({ installed: "1", newest: "2", older: true, build: "jailbreak" }), ["Upgrade", "Downgrade", "Remove"]);
  assert.deepEqual(modifyActions({ installed: null, newest: "1", build: "jailbreak" }), ["Install"]);
  assert.deepEqual(modifyActions({ installed: "1", newest: "2" }), ["Upgrade"]); // no build: neither
  assert.equal(destructiveOf(["Upgrade", "Downgrade", MARK_NOT_INSTALLED]), 2);
  assert.equal(destructiveOf(["Upgrade", "Remove"]), 1);
  assert.equal(destructiveOf(["Clear", "Install"]), -1);
});

const pkg = (versions) => ({ key: "alt:k", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
  sourceUrl: "https://s/", versions } } });
const A = pkg([{ version: "2", downloadURL: "https://s/a2.ipa" }, { version: "1", downloadURL: "https://s/a1.ipa" }]);
const forgetIn = (mem) => async (id) => removeInstall(mem, id);

test("sideload app: Modify's Mark as Not Installed is red and removes the record, nothing queued", async () => {
  const mem = memoryAppStore([{ id: "com.x.a", version: "2" }, { id: "com.x.b", version: "1" }]);
  const q = createAppQueue();
  let sheet = null;
  const done = await appPageAction(A, null, { queue: q, mode: "sideload", ready: async () => true, store: async () => mem, signedOf: async () => null,
    add: () => assert.fail("queued"), forget: forgetIn(mem),
    ask: async (o) => { sheet = o; return o.buttons.indexOf(MARK_NOT_INSTALLED); } });
  assert.equal(done, true);
  assert.deepEqual(sheet.buttons, ["Reinstall", "Downgrade", MARK_NOT_INSTALLED]);
  assert.equal(sheet.destructive, 2);
  assert.deepEqual((await mem.all()).map((r) => r.id), ["com.x.b"]);
  assert.equal(q.size, 0);
});

test("website: an installed app's Modify sheet; Mark as Not Installed forgets it, Upgrade installs as before, Downgrade that version", async () => {
  const mem = memoryAppStore([{ id: "com.x.a", version: "2" }]);
  const base = { mode: "site", store: async () => mem, forget: forgetIn(mem), siteInstall: async () => assert.fail("installed") };
  let sheet = null;
  assert.equal(await appPageAction(A, null, { ...base, ask: async (o) => { sheet = o; return -1; } }), true); // Cancel
  assert.deepEqual(sheet.buttons, ["Reinstall", "Downgrade", MARK_NOT_INSTALLED]);
  assert.equal(sheet.destructive, 2);
  assert.equal((await mem.all()).length, 1);
  // Reinstall: false, so the page's own Install (signed in the browser) runs
  assert.equal(await appPageAction(A, null, { ...base, ask: async () => 0 }), false);
  // Downgrade, then which version: installed through siteInstall
  const got = [];
  const answers = [1, 0];
  assert.equal(await appPageAction(A, null, { ...base, siteInstall: async (p, v) => got.push(v.version), ask: async () => answers.shift() }), true);
  assert.deepEqual(got, ["1"]);
  // Mark as Not Installed
  assert.equal(await appPageAction(A, null, { ...base, ask: async () => 2 }), true);
  assert.deepEqual(await mem.all(), []);
  // Not installed now: no sheet, the page installs it
  assert.equal(await appPageAction(A, null, { ...base, ask: async () => assert.fail("asked") }), false);
  // Version History's Install of one version: no sheet on the website either
  const again = memoryAppStore([{ id: "com.x.a", version: "2" }]);
  assert.equal(await appPageAction(A, null, { ...base, store: async () => again, version: "1", ask: async () => assert.fail("asked") }), false);
});

test("jailbreak build: no app Modify sheet here (the page installs through the helper)", async () => {
  const mem = memoryAppStore([{ id: "com.x.a", version: "2" }]);
  assert.equal(await appPageAction(A, null, { mode: "jailbreak", store: async () => mem, ask: async () => assert.fail("asked") }), false);
});
