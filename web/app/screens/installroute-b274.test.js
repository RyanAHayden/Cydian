// B274: Tailscale's Test Connection asks tailscale.test to check the kept pairing too ({verify: true}); when the
// phone no longer accepts it (R55: the channel reset during pair-verify, "early eof"), the answer is Pair Again, whose
// button forgets the pairing and opens the pairing page, instead of "Connected".
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";
import { tailscaleTestResult } from "../core/installroute.js";

globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);
const { drawInstallation, hudHooks, forgetStatus, recheckHooks, leave } = await import("./installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const tap = (box, label) => {
  const cell = cellOf(box, label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const store = () => { const m = { installRoute: "iphone" }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };
const TS_ON = { connect: "auto", signedIn: true, name: "ifizbox-on-iphone", address: "100.81.244.3", use: true };
const PAIRED = { paired: "rp", pairOnPhone: true, localDevVPN: false, otherVPN: false, tailscale: TS_ON };
// R55's install error, as idevice.verify gives it through tailscale.test's detail
const EOF = 'connect_failed: Socket(Custom { kind: UnexpectedEof, error: "early eof" }) (1)';

function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p) => { calls.push([m, p]); const a = answers[m]; return typeof a === "function" ? a(p) : Promise.resolve(a); } };
}

test("verify_failed: a pairing the phone no longer accepts is Pair Again; other failures aren't", () => {
  const stale = tailscaleTestResult({ ok: false, code: "verify_failed", detail: EOF, paired: true });
  assert.equal(stale.title, "Pair Again");
  assert.equal(stale.again, true);
  assert.match(stale.message, /Tailscale reached this iPhone/);
  assert.doesNotMatch(stale.message, /UnexpectedEof|early eof|Socket/);
  for (const d of ["refused: this iPhone refused RemotePairing on port 49152", "pairing_rejected: this iPhone didn't accept the pairing (PairVerifyFailed)", "bad_pairing: x"]) {
    assert.equal(tailscaleTestResult({ ok: false, code: "verify_failed", detail: d }).title, "Pair Again", d);
  }
  const late = tailscaleTestResult({ ok: false, code: "verify_failed", detail: "timeout: connecting to iOS: no answer from iOS for 30 s" });
  assert.equal(late.title, "Couldn't Connect", "a timeout isn't proof the pairing is stale");
  assert.ok(!late.again);
  assert.equal(tailscaleTestResult({ ok: true, verified: true, ms: 80 }).title, "Connected");
});

test("Test Connection asks for the pairing check; Pair Again forgets the pairing and opens Pairing", async () => {
  forgetStatus();
  let went = 0;
  const goPair = recheckHooks.goPair;
  recheckHooks.goPair = () => { went++; };
  try {
    const alerts = [];
    const native = bridge({ "idevice.status": PAIRED, "tailscale.status": TS_ON, "idevice.forget": { paired: null },
      "tailscale.test": { ok: false, code: "verify_failed", detail: EOF, paired: true } });
    const box = make("div");
    await drawInstallation(box, "iphone", { store: store(), native, alert: async (a) => { alerts.push(a); return { index: 1 }; } });
    await tap(box, "Test Connection");
    const t = native.calls.find(([m]) => m === "tailscale.test");
    assert.deepEqual(t[1], { verify: true });
    assert.deepEqual(alerts.map((a) => a.title), ["Pair Again"]);
    assert.deepEqual(alerts[0].buttons, ["Cancel", "Pair Again"]);
    assert.ok(native.calls.some(([m]) => m === "idevice.forget"), "the stale pairing is forgotten");
    assert.equal(went, 1, "the pairing page opens");
  } finally { recheckHooks.goPair = goPair; leave(); }
});

test("Cancel on Pair Again keeps the pairing", async () => {
  forgetStatus();
  const native = bridge({ "idevice.status": PAIRED, "tailscale.status": TS_ON,
    "tailscale.test": { ok: false, code: "verify_failed", detail: EOF, paired: true } });
  const box = make("div");
  await drawInstallation(box, "iphone", { store: store(), native, alert: async () => ({ index: 0 }) });
  await tap(box, "Test Connection");
  assert.ok(!native.calls.some(([m]) => m === "idevice.forget"));
  leave();
});
