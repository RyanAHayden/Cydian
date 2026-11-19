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

test("Another VPN Is On: Open LocalDevVPN stops the install and opens it", async () => {
  forgetRoute();
  const calls = [];
  const r = await chooseRoute({ native: fake({ paired: "rp", localDevVPN: false, otherVPN: true }, calls), storage: store("iphone"),
    alert: async (a) => { assert.equal(a.title, "Another VPN Is On"); return { index: 1 }; } });
  assert.equal(r, null);
  assert.deepEqual(calls, ["idevice.status", "idevice.openLocalDevVPN"]);
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
