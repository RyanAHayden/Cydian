// B110: signing-client.js waitForVPN, the wait after Open LocalDevVPN: idevice.status every 2 s and when the app is back
// in front, on until LocalDevVPN is on (paired) or the signal aborts. core/apprun.js says it on the queue's row.
import test from "node:test";
import assert from "node:assert/strict";

const { waitForVPN } = await import("./signing-client.js");
const { rowStatus, runStatus } = await import("./core/apprun.js");
const { VPN_POLL, vpnReady } = await import("./core/installroute.js");

// Timers run by hand: later(fn, ms) queues, fire() runs what is queued.
function clock() {
  const q = new Map();
  let n = 0;
  return {
    later: (fn, ms) => { q.set(++n, { fn, ms }); return n; },
    clear: (id) => { q.delete(id); },
    get pending() { return [...q.values()]; },
    fire() { const all = [...q.entries()]; q.clear(); for (const [, t] of all) t.fn(); },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const phone = (answers) => {
  const calls = [];
  return { calls, call: async (m) => { calls.push(m); const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return a; } };
};
const doc = () => {
  const fns = new Set();
  return { visibilityState: "visible", addEventListener: (e, f) => fns.add(f), removeEventListener: (e, f) => fns.delete(f), show() { for (const f of [...fns]) f(); }, get listeners() { return fns.size; } };
};

test("vpnReady: paired and LocalDevVPN on", () => {
  assert.equal(vpnReady({ paired: "rp", localDevVPN: true }), true);
  assert.equal(vpnReady({ paired: "rp", localDevVPN: false, otherVPN: true }), false);
  assert.equal(vpnReady({ localDevVPN: true }), false);
  assert.equal(vpnReady(null), false);
});

test("asks every 2 s, a failed call counts as not yet, and goes on once LocalDevVPN is on", async () => {
  const c = clock();
  const n = phone([{ paired: "rp", localDevVPN: false }, new Error("busy"), { paired: "rp", localDevVPN: true }]);
  const d = doc();
  let result = "pending";
  waitForVPN({ native: n, later: c.later, clear: c.clear, doc: d }).then((r) => { result = r; });
  assert.deepEqual(c.pending.map((t) => t.ms), [VPN_POLL]);
  assert.equal(VPN_POLL, 2000);
  for (let i = 0; i < 2; i++) { c.fire(); await flush(); assert.equal(result, "pending"); }
  c.fire(); await flush();
  assert.equal(result, true);
  assert.deepEqual(n.calls, ["idevice.status", "idevice.status", "idevice.status"]);
  assert.equal(c.pending.length, 0, "no timer left");
  assert.equal(d.listeners, 0, "no listener left");
});

test("back in the foreground: asked at once, without waiting for the timer", async () => {
  const c = clock();
  const n = phone([{ paired: "rp", localDevVPN: true }]);
  const d = doc();
  let result = "pending";
  waitForVPN({ native: n, later: c.later, clear: c.clear, doc: d }).then((r) => { result = r; });
  d.visibilityState = "hidden"; d.show(); await flush();
  assert.equal(result, "pending", "not while hidden");
  d.visibilityState = "visible"; d.show(); await flush();
  assert.equal(result, true);
  assert.equal(c.pending.length, 0);
});

test("only the signal stops it: false, and nothing is asked after", async () => {
  const c = clock();
  const n = phone([{ paired: "rp", localDevVPN: false }]);
  const d = doc();
  const ctl = new AbortController();
  let result = "pending";
  waitForVPN({ native: n, signal: ctl.signal, later: c.later, clear: c.clear, doc: d }).then((r) => { result = r; });
  c.fire(); await flush(); c.fire(); await flush();
  assert.equal(result, "pending");
  ctl.abort(); await flush();
  assert.equal(result, false);
  const asked = n.calls.length;
  c.fire(); d.show(); await flush();
  assert.equal(n.calls.length, asked);
  assert.equal(d.listeners, 0);
});

test("an aborted signal: false at once", async () => {
  const ctl = new AbortController(); ctl.abort();
  assert.equal(await waitForVPN({ native: phone([{}]), signal: ctl.signal, later: () => assert.fail("no timer") }), false);
});

test("the queue's row while it waits: Waiting for LocalDevVPN…", () => {
  const row = { id: "a", name: "Delta", state: "asking", phase: "vpn", fraction: 0 };
  assert.equal(rowStatus(row), "Waiting for LocalDevVPN…");
  assert.equal(runStatus([row]), "Waiting for LocalDevVPN…");
  assert.equal(rowStatus({ ...row, phase: null }), "Tap Install on the iOS prompt");
});
