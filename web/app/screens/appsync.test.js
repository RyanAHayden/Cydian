// F189: the jailbreak build's first IPA install gets AppSync Unified first (screens/ipa-install.js ensureAppSync,
// installWithAppSync) and waits on the install queue's run for it (screens/queue.js whenQueueRuns).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureAppSync, installWithAppSync, appSyncFallback } from "./ipa-install.js";
import { whenQueueRuns, takeWaiters } from "./queue.js";
import { createQueue } from "../core/queue.js";
import { APPSYNC_ID, APPSYNC_SOURCE, APPSYNC_PAGE } from "../core/appsync.js";

const STATUS_WITHOUT = "Package: com.example.a\nStatus: install ok installed\n";
const STATUS_WITH = `${STATUS_WITHOUT}\nPackage: ${APPSYNC_ID}\nStatus: install ok installed\nVersion: 116.0\n`;

// A native backend's shape, as far as ensureAppSync uses it. `log` records the calls in order.
function fakeBackend({ status = STATUS_WITHOUT, sources = [], addFails = false, refresh = "ok" } = {}) {
  const log = [];
  const list = [...sources];
  return {
    log, list,
    dpkgStatus: async () => { log.push("dpkgStatus"); return status; },
    sources: async () => list,
    async addSource(url) {
      log.push(`add ${url}`);
      if (addFails) throw new Error("Verification Error");
      const s = { key: "akemi", uri: url };
      list.push(s);
      return s;
    },
    async refreshSources(onEach, { filter }) {
      log.push(`refresh ${list.filter(filter).map((s) => s.key).join(",")}`);
      if (refresh === "throws") throw new Error("apt-get update failed (100): E: Some index files failed to download");
      const rows = list.filter(filter).map((s) => ({ ...s, aptError: refresh === "aptError" ? "E: Failed to fetch" : null }));
      return Object.assign(rows, { failed: [] });
    },
    queue(job) { log.push(`queue ${job.id} ${job.version} ${job.name}`); },
  };
}
const fakeCatalog = (pkg = { key: "akemi", row: { name: "AppSync Unified" }, stanza: { version: "116.0" } }) => ({
  ensure: async () => {}, package: async (id, key) => (id === APPSYNC_ID && pkg && key === pkg.key ? pkg : null),
});
const noHud = () => () => {};

test("ensureAppSync: nothing to do when dpkg has AppSync, or when the backend can't queue (sideload, site)", async () => {
  const b = fakeBackend({ status: STATUS_WITH });
  assert.deepEqual(await ensureAppSync({ backend: b, catalog: fakeCatalog(), hud: noHud }), { ok: true, present: true });
  assert.deepEqual(b.log, ["dpkgStatus"]);
  assert.deepEqual(await ensureAppSync({ backend: { dpkgStatus: async () => "" } }), { ok: true });
  assert.deepEqual(await ensureAppSync({ backend: null }), { ok: true });
});

test("ensureAppSync: adds akemi's source, refreshes only it, queues AppSync and waits for the run", async () => {
  const b = fakeBackend();
  const huds = [];
  const waits = [];
  const r = await ensureAppSync({ name: "opentennis-ios", backend: b, catalog: fakeCatalog(),
    hud: (t) => { huds.push(t); return () => huds.push(`-${t}`); },
    wait: (id, { note }) => { waits.push({ id, note, queuedYet: b.log.some((l) => l.startsWith("queue")) }); return Promise.resolve("installed"); } });
  assert.deepEqual(r, { ok: true, installed: true });
  assert.deepEqual(b.log, ["dpkgStatus", `add ${APPSYNC_SOURCE}`, "refresh akemi", `queue ${APPSYNC_ID} 116.0 AppSync Unified`]);
  assert.deepEqual(huds, ["Getting AppSync Unified", "-Getting AppSync Unified"]); // one HUD, hidden before the queue
  assert.equal(waits.length, 1);
  assert.equal(waits[0].id, APPSYNC_ID);
  assert.equal(waits[0].queuedYet, false); // the note is there before Confirm opens
  assert.match(waits[0].note, /opentennis-ios installs right after it/);
});

test("ensureAppSync: a source already added (typed another way) isn't added again", async () => {
  const b = fakeBackend({ sources: [{ key: "mine", uri: "http://cydia.akemi.ai" }, { key: "other", uri: "https://repo.example/" }] });
  const r = await ensureAppSync({ backend: b, catalog: fakeCatalog({ key: "mine", stanza: { version: "116.0" } }), hud: noHud,
    wait: () => Promise.resolve("installed") });
  assert.equal(r.ok, true);
  assert.deepEqual(b.log, ["dpkgStatus", "refresh mine", `queue ${APPSYNC_ID} 116.0 AppSync Unified`]);
});

test("ensureAppSync: each failing step says which, and nothing is queued", async () => {
  const run = (opts, cat = fakeCatalog()) => {
    const b = fakeBackend(opts);
    return ensureAppSync({ backend: b, catalog: cat, hud: noHud, wait: () => Promise.resolve("installed") })
      .then((r) => ({ r, queued: b.log.some((l) => l.startsWith("queue")) }));
  };
  assert.deepEqual(await run({ addFails: true }), { r: { ok: false, step: "add" }, queued: false });
  assert.deepEqual(await run({ refresh: "throws" }), { r: { ok: false, step: "refresh" }, queued: false });
  assert.deepEqual(await run({ refresh: "aptError" }), { r: { ok: false, step: "refresh" }, queued: false });
  assert.deepEqual(await run({}, fakeCatalog(null)), { r: { ok: false, step: "missing" }, queued: false });
  // a package by that id from another source isn't akemi's
  assert.deepEqual(await run({}, { ensure: async () => {}, package: async () => ({ key: "elsewhere", stanza: {} }) }),
    { r: { ok: false, step: "missing" }, queued: false });
});

test("ensureAppSync: a source that never answers (Cloudflare 522 after ~19 s a request) fails at its time limit", async () => {
  const never = new Promise(() => {});
  const hung = { ...fakeBackend(), addSource: () => never };
  const hudLog = [];
  const t0 = Date.now();
  const r = await ensureAppSync({ backend: hung, catalog: fakeCatalog(), hud: (t) => { hudLog.push(t); return () => hudLog.push("-"); },
    limits: { add: 30, refresh: 30 }, wait: () => Promise.resolve("installed") });
  assert.deepEqual(r, { ok: false, step: "add" });
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(hudLog, ["Getting AppSync Unified", "-"]); // gone before the fallback alert
  const slow = { ...fakeBackend({ sources: [{ key: "akemi", uri: APPSYNC_SOURCE }] }), refreshSources: () => never };
  assert.deepEqual(await ensureAppSync({ backend: slow, catalog: fakeCatalog(), hud: noHud, limits: { add: 30, refresh: 30 } }),
    { ok: false, step: "refresh" });
});

test("ensureAppSync: the queue run's outcome: failed is the install step, cancelled stops quietly", async () => {
  const go = (how) => ensureAppSync({ backend: fakeBackend(), catalog: fakeCatalog(), hud: noHud, wait: () => Promise.resolve(how) });
  assert.deepEqual(await go("failed"), { ok: false, step: "install" });
  assert.deepEqual(await go("cancelled"), { cancelled: true });
});

test("installWithAppSync: AppSync first, then the IPA's console", async () => {
  const order = [];
  const r = await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async ({ name }) => { order.push(`ensure ${name}`); return { ok: true, installed: true }; },
    fallback: async () => { order.push("fallback"); return false; },
    run: async ({ url, name }) => { order.push(`run ${name} ${url}`); return { ok: true }; },
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(order, ["ensure A", "run A https://x.example/A.ipa"]);
});

test("installWithAppSync: a failed auto-install shows the fallback; Try Again goes round, OK stops, Cancel says nothing", async () => {
  const steps = [];
  let tries = 0;
  const runs = [];
  const r = await installWithAppSync({ url: "https://x.example/A.ipa", name: "A" }, {
    ensure: async () => (++tries === 1 ? { ok: false, step: "refresh" } : { ok: true, installed: true }),
    fallback: async (step) => { steps.push(step); return true; },
    run: async (o) => { runs.push(o.name); return { ok: true }; },
  });
  assert.deepEqual(steps, ["refresh"]);
  assert.equal(tries, 2);
  assert.deepEqual(runs, ["A"]);
  assert.deepEqual(r, { ok: true });

  const none = [];
  assert.equal(await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async () => ({ ok: false, step: "install" }), fallback: async () => false, run: async () => { none.push(1); } }), false);
  assert.equal(await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async () => ({ cancelled: true }), fallback: async () => { none.push(2); }, run: async () => { none.push(3); } }), false);
  assert.deepEqual(none, []);
});

test("installWithAppSync: installd still refusing (no_adhoc) gets the short fallback, and Try Again closes the console first", async () => {
  const steps = [];
  let closed = 0, runs = 0;
  const refused = () => ({ ok: false, error: { code: "no_adhoc" }, close: async () => { closed++; } });
  const r = await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async () => ({ ok: true, present: true }),
    fallback: async (step) => { steps.push(step); return steps.length < 2; },
    run: async () => { runs++; return refused(); },
  });
  assert.deepEqual(steps, ["refused", "refused"]);
  assert.equal(runs, 2);
  assert.equal(closed, 1);
  assert.equal(r.error.code, "no_adhoc");
  const s2 = [];
  await installWithAppSync({ url: "https://x.example/A.ipa" }, {
    ensure: async () => ({ ok: true }), fallback: async (step) => { s2.push(step); return false; }, run: async () => refused() });
  assert.deepEqual(s2, ["absent"]);
});

test("appSyncFallback: one sentence, Try Again / Open Source / OK; Open Source opens AppSync's page on akemi's repo", async () => {
  const shown = [];
  const opened = [];
  const again = await appSyncFallback("refresh", { alert: async (a) => { shown.push(a); return { index: 0 }; }, open: (u) => opened.push(u) });
  assert.equal(again, true);
  assert.equal(shown[0].message, "Couldn't refresh cydia.akemi.ai.");
  assert.deepEqual(shown[0].buttons, ["Try Again", "Open Source", "OK"]);
  assert.equal(shown[0].cancel, 2);
  assert.equal(await appSyncFallback("install", { alert: async () => ({ index: 1 }), open: (u) => opened.push(u) }), false);
  assert.deepEqual(opened, [APPSYNC_PAGE]);
  assert.equal(await appSyncFallback("install", { alert: async () => ({ index: 2 }), open: (u) => opened.push(u) }), false);
  assert.equal(opened.length, 1);
});

test("whenQueueRuns: cleared (Confirm's Cancel) is cancelled; a run takes its waiters before clearing the queue", async () => {
  const q = createQueue();
  q.add({ op: "install", id: APPSYNC_ID });
  const p1 = whenQueueRuns(APPSYNC_ID, { queue: q });
  q.clearAll();
  assert.equal(await p1, "cancelled");

  q.add({ op: "install", id: APPSYNC_ID });
  const p2 = whenQueueRuns(APPSYNC_ID, { queue: q, note: "n" });
  q.clear("com.example.other"); // another package's clear isn't this one's
  const w = takeWaiters(["com.example.other", APPSYNC_ID]);
  assert.equal(w.length, 1);
  assert.equal(w[0].note, "n");
  q.clearAll(); // the run's own clear: no longer waited on
  w[0].resolve("installed");
  assert.equal(await p2, "installed");
  assert.equal(takeWaiters([APPSYNC_ID]).length, 0);
});
