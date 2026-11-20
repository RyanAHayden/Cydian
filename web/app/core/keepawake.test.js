// F287: the screen stays on while work runs: core/keepawake.js's count, the IPA queue run's keepAwake (core/apprun.js),
// the app backend's long calls and keepAwake (backend-native.js over the fake shell) and the site's Screen Wake Lock
// (wakeLockScreen, backend-http.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeepAwake, wakeLockScreen } from "./keepawake.js";
import { createAppRun, appRows } from "./apprun.js";
import { createNativeBackend, longCall } from "../backend-native.js";
import { createHttpBackend } from "../backend-http.js";
import { fakeIndexedDB } from "../../../native/fake/fake-indexeddb.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("createKeepAwake: on with the first hold, off after the last; releases are once only", () => {
  const seen = [];
  const a = createKeepAwake((on) => seen.push(on));
  const r1 = a.hold();
  const r2 = a.hold();
  assert.deepEqual(seen, [true]);
  r1();
  r1(); // twice: harmless
  assert.deepEqual(seen, [true]);
  assert.equal(a.count, 1);
  r2();
  assert.deepEqual(seen, [true, false]);
  assert.equal(a.on, false);
  a.set(true); a.set(true); a.set(false);
  assert.deepEqual(seen, [true, false, true]);
  a.set(false);
  a.set(false); // more offs than ons: nothing goes below zero
  assert.deepEqual(seen, [true, false, true, false]);
  assert.equal(a.count, 0);
});

test("createKeepAwake: a failing screen never fails the job; during() releases on success and failure", async () => {
  const seen = [];
  const a = createKeepAwake((on) => { seen.push(on); if (on) throw new Error("no screen"); return Promise.reject(new Error("x")); });
  const ok = await a.during(Promise.resolve(7));
  assert.equal(ok, 7);
  await tick();
  await assert.rejects(a.during(Promise.reject(new Error("boom"))), /boom/);
  await tick();
  assert.deepEqual(seen, [true, false, true, false]);
  assert.equal(a.count, 0);
});

// ---- the IPA queue run --------------------------------------------------------------------------------------------

const jobs = (n) => Array.from({ length: n }, (_, i) => ({ id: `com.app${i}`, name: `App ${i}`, mode: "install", url: `https://x/${i}.ipa` }));

test("app run: keepAwake(true) with the start, false once the last row is installed", async () => {
  const seen = [];
  const rows = appRows(jobs(3));
  const run = createAppRun({ rows, sign: async () => ({ token: "t" }), install: async () => { seen.push("install"); return { installed: true }; },
    keepAwake: (on) => seen.push(on) });
  const end = run.start();
  assert.deepEqual(seen, [true]);
  await end;
  assert.deepEqual(seen, [true, "install", "install", "install", false]);
});

test("app run: off after a failure, and on again for a retry's new pass", async () => {
  const seen = [];
  let tries = 0;
  const rows = appRows(jobs(1));
  const run = createAppRun({ rows, sign: async () => { if (!tries++) throw new Error("bad IPA"); return { token: "t" }; },
    install: async () => ({ installed: true }), keepAwake: (on) => seen.push(on) });
  await run.start();
  assert.equal(rows[0].state, "failed");
  assert.deepEqual(seen, [true, false]);
  await run.retry(rows[0].id);
  assert.equal(rows[0].state, "installed");
  assert.deepEqual(seen, [true, false, true, false]);
});

test("app run: Cancel mid-signing turns it off once; a stalled row too", async () => {
  const seen = [];
  const rows = appRows(jobs(2));
  const run = createAppRun({ rows, keepAwake: (on) => seen.push(on),
    sign: (r, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))),
    install: async () => ({ installed: true }) });
  const end = run.start();
  await tick();
  assert.deepEqual(seen, [true]);
  run.cancel();
  await end;
  assert.deepEqual(seen, [true, false]);

  const seen2 = [];
  let fire = null;
  const rows2 = appRows(jobs(1));
  const run2 = createAppRun({ rows: rows2, keepAwake: (on) => seen2.push(on), later: (f) => { fire = f; return 1; }, clear: () => {},
    sign: (r, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))),
    install: async () => ({ installed: true }) });
  const end2 = run2.start();
  await tick();
  fire();
  await end2;
  assert.equal(rows2[0].state, "failed");
  assert.deepEqual(seen2, [true, false]);
});

test("app run: a keepAwake that throws or rejects doesn't stop the run", async () => {
  const rows = appRows(jobs(1));
  const run = createAppRun({ rows, sign: async () => ({ token: "t" }), install: async () => ({ installed: true }),
    keepAwake: (on) => { if (on) throw new Error("x"); return Promise.reject(new Error("y")); } });
  await run.start();
  assert.equal(rows[0].state, "installed");
});

// ---- the app backend ----------------------------------------------------------------------------------------------

function standIn() {
  const awake = [];
  const calls = [];
  const waits = [];
  const native = {
    async call(method, params = {}) {
      if (method === "app.keepAwake") { awake.push(params.on); return { on: params.on }; }
      calls.push(method);
      if (method === "share.debFetch" || (method === "helper.run" && params.stream)) {
        return new Promise((res, rej) => waits.push({ res, rej }));
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak" } });
  return { backend, awake, calls, waits };
}

test("longCall: streamed helper runs and .deb downloads/installs keep the screen on; quick calls don't", () => {
  assert.equal(longCall("helper.run", { words: ["apply-ask"], stream: true }), true);
  assert.equal(longCall("helper.run", { words: ["simulate"], stream: false }), false);
  assert.equal(longCall("share.debFetch", {}), true);
  assert.equal(longCall("share.debInstall", {}), true);
  assert.equal(longCall("apt.dpkgStatus", {}), false);
  assert.equal(longCall("net.fetch", {}), false);
});

test("native backend: an apt run holds the screen on until it ends, or fails", async () => {
  const s = standIn();
  const p1 = s.backend.helper(["apply-ask", "com.a"], () => {});
  const p2 = s.backend.helper(["update"], () => {});
  await tick();
  assert.deepEqual(s.awake, [true], "one switch for overlapping runs");
  await s.backend.helper(["simulate", "com.a"]);
  assert.deepEqual(s.awake, [true]);
  s.waits[0].res({ code: 0, stdout: "", stderr: "" });
  await p1;
  await tick();
  assert.deepEqual(s.awake, [true], "the update still runs");
  s.waits[1].rej(new Error("network: offline"));
  await assert.rejects(p2);
  await tick();
  assert.deepEqual(s.awake, [true, false]);
});

test("native backend: keepAwake(on) from a job runner shares the count with long calls", async () => {
  const s = standIn();
  s.backend.keepAwake(true);
  await tick();
  const p = s.backend.helper(["apply-ask", "com.a"], () => {});
  s.backend.keepAwake(false);
  await tick();
  assert.deepEqual(s.awake, [true], "the apt run still holds it");
  s.waits[0].res({ code: 0, stdout: "", stderr: "" });
  await p;
  await tick();
  assert.deepEqual(s.awake, [true, false]);
});

test("native backend: an older shell without app.keepAwake changes nothing", async () => {
  const native = {
    async call(method, params) {
      if (method === "app.keepAwake") throw new Error("unknown method app.keepAwake");
      return method === "helper.run" ? { code: 0, stdout: "ok", stderr: "" } : null;
    },
  };
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak" } });
  assert.equal((await backend.helper(["update"], () => {})).stdout, "ok");
  backend.keepAwake(true);
  backend.keepAwake(false);
  await tick();
});

// ---- the website ---------------------------------------------------------------------------------------------------

function fakeLock() {
  const events = [];
  let live = null;
  const doc = { visibilityState: "visible", listeners: {}, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); } };
  const nav = {
    wakeLock: {
      async request(kind) {
        events.push(`request ${kind}`);
        const ls = [];
        const s = {
          released: false,
          addEventListener: (t, f) => ls.push(f),
          async release() { if (s.released) return; s.released = true; events.push("release"); ls.forEach((f) => f()); },
          drop() { s.released = true; ls.forEach((f) => f()); }, // the browser's own release (page hidden)
        };
        live = s;
        return s;
      },
    },
  };
  const hide = () => { doc.visibilityState = "hidden"; live?.drop(); doc.listeners.visibilitychange?.forEach((f) => f()); };
  const show = () => { doc.visibilityState = "visible"; doc.listeners.visibilitychange?.forEach((f) => f()); };
  return { events, doc, nav, hide, show };
}

test("wakeLockScreen: asks for the screen lock, again when the page comes back, and releases it at the end", async () => {
  const f = fakeLock();
  const screen = wakeLockScreen({ navigator: f.nav, document: f.doc });
  await screen(true);
  assert.deepEqual(f.events, ["request screen"]);
  await screen(true); // already held: no second request
  assert.deepEqual(f.events, ["request screen"]);
  f.hide();
  f.show();
  await tick();
  assert.deepEqual(f.events, ["request screen", "request screen"]);
  await screen(false);
  assert.deepEqual(f.events, ["request screen", "request screen", "release"]);
  f.hide();
  f.show();
  await tick();
  assert.equal(f.events.length, 3, "not wanted: not asked for again");
});

test("wakeLockScreen: no API or a refusal is a no-op", async () => {
  await wakeLockScreen({ navigator: {}, document: null })(true);
  const refusing = { wakeLock: { request: () => Promise.reject(new Error("NotAllowedError")) } };
  const screen = wakeLockScreen({ navigator: refusing, document: { visibilityState: "visible", addEventListener() {} } });
  await screen(true);
  await screen(false);
});

test("site backend: keepAwake(on) is counted onto the screen lock", async () => {
  const seen = [];
  const backend = createHttpBackend({ fetchFn: async () => new Response(""), sourceOptions: { indexedDB: fakeIndexedDB() },
    screen: (on) => seen.push(on) });
  backend.keepAwake(true);
  backend.keepAwake(true);
  backend.keepAwake(false);
  assert.deepEqual(seen, [true]);
  backend.keepAwake(false);
  assert.deepEqual(seen, [true, false]);
});
