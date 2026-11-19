// B61: an IPA installed right after AppSync Unified ends on Restart SpringBoard (screens/ipa-install.js ipaFinish):
// AppSync's FrontBoard hook loads into SpringBoard only on a respring, and until then the app won't open.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { ipaFinish, installWithAppSync, appSyncRespringPending, setAppSyncRespring } from "./ipa-install.js";

function fakeBackend({ uicache = true, respring = true, respringFails = false } = {}) {
  const log = [];
  return {
    log,
    ...(uicache ? { uicache: async () => { log.push("uicache"); } } : {}),
    ...(respring ? { respring: async () => { log.push("respring"); if (respringFails) throw new Error("helper: no"); } } : {}),
  };
}
const noAlert = async () => ({ index: 0 });

test("ipaFinish: without a fresh AppSync, Reload Data as before (Close iFizBox when it failed or can't uicache)", async () => {
  const b = fakeBackend();
  const f = ipaFinish({ ok: true, name: "A.ipa", backend: b, pending: false, alert: noAlert });
  assert.equal(f.label, "Reload Data");
  assert.equal(f.note, null);
  assert.equal(await f.action(), false);
  assert.deepEqual(b.log, ["uicache"]);
  const failed = ipaFinish({ ok: false, backend: fakeBackend(), pending: true, alert: noAlert });
  assert.match(failed.label, /^Close /);
  assert.equal(failed.action, null);
  assert.equal(failed.note, null);
  const bare = ipaFinish({ ok: true, backend: {}, pending: false, alert: noAlert });
  assert.match(bare.label, /^Close /);
  assert.equal(bare.action, null);
});

test("ipaFinish: right after AppSync went in, Restart SpringBoard (uicache first) with a line saying why", async () => {
  setAppSyncRespring(true);
  const b = fakeBackend();
  const f = ipaFinish({ ok: true, name: "opentennis.ipa", backend: b, alert: noAlert });
  assert.equal(f.label, "Restart SpringBoard");
  assert.equal(f.level, "restart");
  assert.match(f.note, /^opentennis opens once SpringBoard restarts/);
  assert.match(f.note, /AppSync Unified/);
  assert.equal(await f.action(), false);
  assert.deepEqual(b.log, ["uicache", "respring"]);
  assert.equal(appSyncRespringPending(), false); // done: the next IPA is back to Reload Data
  assert.equal(ipaFinish({ ok: true, backend: fakeBackend(), alert: noAlert }).label, "Reload Data");
});

test("ipaFinish: a failed respring keeps the page up, says so, and stays pending", async () => {
  setAppSyncRespring(true);
  const shown = [];
  const f = ipaFinish({ ok: true, backend: fakeBackend({ respringFails: true }), alert: async (a) => { shown.push(a); return { index: 0 }; } });
  assert.equal(await f.action(), true);
  assert.equal(shown[0].title, "Restart SpringBoard");
  assert.equal(appSyncRespringPending(), true);
  setAppSyncRespring(false);
});

test("ipaFinish: a backend that can't respring says the app opens after a respring", () => {
  const f = ipaFinish({ ok: true, name: "A", backend: fakeBackend({ respring: false }), pending: true, alert: noAlert });
  assert.equal(f.label, "Reload Data");
  assert.match(f.note, /^A opens after a respring/);
});

test("installWithAppSync: AppSync installed by this run marks the respring; one already there doesn't", async () => {
  setAppSyncRespring(false);
  let seen = null;
  await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async () => ({ ok: true, present: true }), fallback: async () => false,
    run: async () => { seen = appSyncRespringPending(); return { ok: true }; } });
  assert.equal(seen, false);
  await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async () => ({ ok: true, installed: true }), fallback: async () => false,
    run: async () => { seen = appSyncRespringPending(); return { ok: true }; } });
  assert.equal(seen, true);
  // a later IPA before the respring (dpkg now says present) still ends on it
  await installWithAppSync({ url: "https://x.example/B.ipa" }, {
    ensure: async () => ({ ok: true, present: true }), fallback: async () => false,
    run: async () => { seen = appSyncRespringPending(); return { ok: true }; } });
  assert.equal(seen, true);
  setAppSyncRespring(false);
});
