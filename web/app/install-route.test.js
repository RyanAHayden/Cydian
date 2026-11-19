// signing-client.js chooseRoute: what an install sends for Settings > Installation's route, and its alerts.
import test from "node:test";
import assert from "node:assert/strict";

const store = (v) => ({ getItem: (k) => (k === "ifizbox.installRoute" ? v : null) });
const fake = (status, calls = []) => ({ call: async (m, p) => { calls.push(m); if (m === "idevice.status") { if (status instanceof Error) throw status; return status; } return { opened: true }; } });
const { chooseRoute, forgetRoute } = await import("./signing-client.js");

test("Signing Server chosen: nothing asked, nothing added", async () => {
  forgetRoute();
  const calls = [];
  assert.deepEqual(await chooseRoute({ native: fake({}, calls), storage: store(null), alert: () => assert.fail("no alert") }), {});
  assert.deepEqual(calls, []);
});

test("This iPhone, paired, LocalDevVPN on: route idevice, no alert", async () => {
  forgetRoute();
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: true }), storage: store("iphone"), alert: () => assert.fail("no alert") });
  assert.deepEqual(r, { route: "idevice" });
});

test("LocalDevVPN off: the server, said in an alert", async () => {
  forgetRoute();
  const seen = [];
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: false }), storage: store("iphone"), alert: async (a) => { seen.push(a.title); return { index: 0 }; } });
  assert.deepEqual(r, {});
  assert.deepEqual(seen, ["LocalDevVPN Is Off"]);
});

// B110: Open LocalDevVPN keeps the install waiting on a "Waiting for LocalDevVPN…" page with Cancel.
const fakeHud = () => {
  const ctl = new AbortController();
  const h = { labels: [], ended: null, signal: ctl.signal, get cancelled() { return ctl.signal.aborted; }, cancel: () => ctl.abort(),
    done: (t) => { h.ended = t; } };
  return h;
};
const soon = (fn) => fn(); // later() for the page's end: at once

test("Another VPN Is On: Open LocalDevVPN opens it and waits; connected, the install goes on through This iPhone", async () => {
  forgetRoute();
  const calls = [];
  let h = null;
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: false, otherVPN: true }, calls), storage: store("iphone"),
    alert: async (a) => { assert.equal(a.title, "Another VPN Is On"); return { index: 1 }; },
    hud: (label) => { h = fakeHud(); h.labels.push(label); return h; }, later: soon,
    wait: async ({ signal }) => { assert.equal(signal, h.signal); return true; } });
  assert.deepEqual(r, { route: "idevice" });
  assert.deepEqual(calls, ["idevice.status", "idevice.openLocalDevVPN"]);
  assert.deepEqual(h.labels, ["Waiting for LocalDevVPN…"]);
  assert.equal(h.ended, "LocalDevVPN is on");
});

test("LocalDevVPN Is Off: Open LocalDevVPN waits too; Cancel on the page stops the install", async () => {
  forgetRoute();
  let h = null;
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: false }), storage: store("iphone"),
    alert: async (a) => { assert.equal(a.title, "LocalDevVPN Is Off"); return { index: 1 }; },
    hud: () => (h = fakeHud()), later: soon,
    wait: ({ signal }) => new Promise((res) => { signal.addEventListener("abort", () => res(false)); setTimeout(() => h.cancel(), 5); }) });
  assert.equal(r, null);
  assert.equal(h.ended, null);
});

test("Use Server stays the other choice: no waiting", async () => {
  forgetRoute();
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: false, otherVPN: true }), storage: store("iphone"),
    alert: async () => ({ index: 0 }), hud: () => assert.fail("no waiting page"), wait: () => assert.fail("no wait") });
  assert.deepEqual(r, {});
});

test("with a signal (a queue row): no page of its own, onWait says it, the answer holds for the rest of the run", async () => {
  forgetRoute();
  const said = [];
  const ctl = new AbortController();
  let asked = 0;
  const opts = { native: fake({ paired: "rp", localDevVPN: false }), storage: store("iphone"), signal: ctl.signal,
    alert: async () => { asked++; return { index: 1 }; }, hud: () => assert.fail("no page"), onWait: (t) => said.push(t),
    wait: async ({ signal }) => { assert.equal(signal, ctl.signal); return true; } };
  assert.deepEqual(await chooseRoute(opts), { route: "idevice" });
  assert.deepEqual(await chooseRoute(opts), { route: "idevice" });
  assert.equal(asked, 1);
  assert.deepEqual(said, ["Waiting for LocalDevVPN…"]);
});

test("with a signal: the run's Cancel stops the wait", async () => {
  forgetRoute();
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 5);
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: false }), storage: store("iphone"), signal: ctl.signal,
    alert: async () => ({ index: 1 }), later: soon });
  assert.equal(r, null);
});

test("a run asks once: the answer holds for a minute", async () => {
  forgetRoute();
  let t = 0, asked = 0;
  const opts = { native: fake({ paired: "rp", localDevVPN: false }), storage: store("iphone"), now: () => t, alert: async () => { asked++; return { index: 0 }; } };
  await chooseRoute(opts);
  t = 30_000; await chooseRoute(opts);
  assert.equal(asked, 1);
  t = 120_000; await chooseRoute(opts);
  assert.equal(asked, 2);
});
