// B139: in a queue run, one app's failure must not fail the next, and only the user's Cancel or a row's stop marks an
// app Cancelled. The fake bridge below keeps the shell's cancelled tags the way native SignJob does (for the app's
// whole life; a job begun under a cancelled tag starts cancelled), which is what made a second run of the same queue
// end an app "Failed: Cancelled": its tags counted from #1 again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, rowStatus, NOT_YOU } from "./apprun.js";
import { phoneLanes } from "../screens/apprun.js";
import { prepareOnDevice, openPrepared } from "../signing-client.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

const jobs = (...ids) => ids.map((id) => ({ id, name: id, mode: "install", url: `https://x/${id}.ipa` }));
const cancelled = () => Object.assign(new Error("Cancelled"), { code: "cancelled" });

// A shell: prepare signs, open hands to iOS, progress says installed; `failOpen` ids fail at signing.open with their
// own error. signing.cancel {tag} is remembered for good, as SignJob.cancel(tag:) does.
function fakeShell({ failOpen = [], hold = [] } = {}) {
  const cancelledTags = new Set();
  const calls = [];
  const held = new Map();
  return {
    calls, cancelledTags, held,
    call(method, params) {
      calls.push([method, params]);
      const tag = params?.tag;
      if (method === "signing.cancel") { cancelledTags.add(tag); return Promise.resolve({ cancelled: true }); }
      if (tag && cancelledTags.has(tag)) return Promise.reject(cancelled()); // begun under a cancelled tag
      const id = String(tag ?? "").split("#")[0];
      if (method === "signing.prepare") {
        if (hold.includes(id)) return new Promise((resolve) => held.set(id, resolve));
        return Promise.resolve({ token: `t-${id}`, bundleId: `com.${id}` });
      }
      if (method === "signing.open") {
        if (failOpen.includes(id)) return Promise.reject(Object.assign(new Error("install_failed: iOS refused it"), { code: "install_failed" }));
        return Promise.resolve({ bundleId: `com.${id}` });
      }
      if (method === "signing.progress") return Promise.resolve({ installed: true });
      return Promise.resolve({});
    },
  };
}

const sc = { prepareOnDevice, openPrepared, discardPrepared: () => {} };

function runWith(native, ids, extra = {}) {
  const lanes = phoneLanes(sc, { native, ...extra });
  const rows = appRows(jobs(...ids));
  const run = createAppRun({ rows, sign: lanes.sign, install: lanes.install, discard: lanes.discard });
  return { rows, run, end: run.start() };
}

test("B139: app 1 fails at iOS; app 2 still installs, and nothing says Cancelled", async () => {
  const native = fakeShell({ failOpen: ["youmod"] });
  const { rows, end } = runWith(native, ["youmod", "opentennis", "partyboard", "openmx"]);
  await end;
  assert.deepEqual(rows.map((r) => r.state), ["failed", "installed", "installed", "installed"]);
  assert.match(rows[0].error, /refused/);
  assert.ok(!native.calls.some(([m]) => m === "signing.cancel"), "a failure cancels nothing");
});

test("B139: a second run of the same queue doesn't reuse a tag an earlier run's Stop cancelled", async () => {
  const native = fakeShell({ hold: ["opentennis"] });
  // run 1: opentennis is stopped while it signs (signing.cancel {its tag}), then the run is cancelled
  const one = runWith(native, ["youmod", "opentennis"]);
  await flush();
  one.run.stop("opentennis");
  await one.end;
  assert.equal(one.rows[1].state, "cancelled");
  assert.equal(native.cancelledTags.size, 1);
  // run 2, same queue, the same calls in the same order: opentennis installs
  native.held.get("opentennis")?.({ token: "late" });
  const two = runWith(native, ["youmod", "opentennis"]);
  native.held.clear();
  await flush();
  native.held.get("opentennis")?.({ token: "t-opentennis", bundleId: "com.opentennis" });
  await two.end;
  assert.deepEqual(two.rows.map((r) => r.state), ["installed", "installed"]);
});

test("B139: the old per-run count (#1 again) is what collided: the shell starts that job cancelled", async () => {
  const native = fakeShell();
  native.cancelledTags.add("opentennis#4"); // an earlier run's Stop of opentennis's install
  const { rows, end } = runWith(native, ["youmod", "opentennis"], { run: "" });
  await end;
  // the run itself never cancels it: Failed with words that say so, never Cancelled
  assert.equal(rows[0].state, "installed");
  assert.equal(rows[1].state, "failed");
  assert.equal(rows[1].error, NOT_YOU);
  assert.notEqual(rowStatus(rows[1]), "Cancelled");
  assert.doesNotMatch(rowStatus(rows[1]), /^Failed: Cancelled/);
});

test("B139: a sign or install that answers cancelled unasked fails its row with NOT_YOU; the next app goes on", async () => {
  const rows = appRows(jobs("a", "b", "c"));
  const run = createAppRun({
    rows,
    sign: async (r) => { if (r.id === "a") throw cancelled(); return { token: `t-${r.id}`, bundleId: r.id }; },
    install: async (r) => { if (r.id === "b") throw new Error("cancelled"); return { installed: true }; },
  });
  await run.start();
  assert.deepEqual(rows.map((r) => r.state), ["failed", "failed", "installed"]);
  assert.equal(rows[0].error, NOT_YOU);
  assert.equal(rows[1].error, NOT_YOU);
  // the user's own stop still says Cancelled
  const r2 = appRows(jobs("x"));
  let release;
  const run2 = createAppRun({ rows: r2, sign: (r, h) => new Promise((res, rej) => { release = res; h.signal.addEventListener("abort", () => rej(cancelled())); }),
    install: async () => ({ installed: true }) });
  const end2 = run2.start();
  await flush();
  run2.stop("x");
  await end2;
  assert.equal(r2[0].state, "cancelled");
  assert.equal(rowStatus(r2[0]), "Cancelled");
  release?.({});
});
