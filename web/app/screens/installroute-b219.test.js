// B219: after a Tailscale sign-in in Settings, the connection is checked by itself (tailscale.test, tried again
// while the tailnet comes up) and the page lands on its connected state with no alert; only a failure says anything.
// This iPhone's setup page asks nothing after a sign-in (its poll pairs once the VPN is on).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document = fakeDocument();
const { testUntilConnected, connectAfterSignIn, AFTER_SIGN_IN, recheckHooks, hudHooks } = await import("./installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;
recheckHooks.retryMs = 5;
AFTER_SIGN_IN.gapMs = 5;
AFTER_SIGN_IN.budgetMs = 1000;

const PAIRED_TS = { paired: "rp", pairOnPhone: true, localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: true, address: "100.64.0.2", use: true } };

// `tests`: tailscale.test's answers in turn (the last one repeats).
function phone(tests, answers = {}) {
  const calls = [];
  let n = 0;
  return { calls, count: (m) => calls.filter((c) => c === m).length,
    call: (m) => {
      calls.push(m);
      if (m === "tailscale.test") return Promise.resolve(tests[Math.min(n++, tests.length - 1)]);
      const a = answers[m];
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    } };
}

test("a tailnet still coming up is tried again until it connects", async () => {
  const native = phone([{ ok: false, code: "no_interface" }, { ok: false, code: "acl", detail: "dial timeout" }, { ok: false, code: "no_answer" }, { ok: true, ms: 40 }]);
  const r = await testUntilConnected(native);
  assert.equal(r.ok, true);
  assert.equal(native.count("tailscale.test"), 4);
});

test("a failure only the user can fix ends it at once", async () => {
  for (const code of ["needs_approval", "expired", "needs_login", "refused"]) {
    const native = phone([{ ok: false, code }, { ok: true }]);
    const r = await testUntilConnected(native);
    assert.equal(r.code, code);
    assert.equal(native.count("tailscale.test"), 1, code);
  }
  const calls = [];
  const throwing = { call: (m) => { calls.push(m); return Promise.reject(Object.assign(new Error("not_signed_in: sign in to Tailscale first"), { code: "not_signed_in" })); } };
  const r = await testUntilConnected(throwing);
  assert.equal(r.code, "error");
  assert.equal(calls.length, 1, "a call that fails outright isn't tried again");
});

test("it stops trying once the budget is spent and answers the last failure", async () => {
  let t = 0;
  const native = phone([{ ok: false, code: "no_answer" }]);
  const r = await testUntilConnected(native, () => (t += 400));
  assert.equal(r.code, "no_answer");
  assert.ok(native.count("tailscale.test") >= 1 && native.count("tailscale.test") <= 3);
});

test("connected: no alert, the Test Connection row spins meanwhile, the kept pairing is checked", async () => {
  const native = phone([{ ok: false, code: "no_interface" }, { ok: true, ms: 30 }], { "idevice.status": PAIRED_TS, "idevice.verify": {} });
  const alerts = [];
  let redraws = 0;
  const r = await connectAfterSignIn(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => { redraws++; });
  assert.equal(r, "ok");
  assert.deepEqual(alerts, []);
  assert.ok(redraws >= 2, "spinner on, then off");
  assert.ok(native.calls.includes("idevice.verify"), "B220's pairing check still runs");
});

test("connected from Settings' main page: the HUD instead of a row, still no alert", async () => {
  const native = phone([{ ok: true }], { "idevice.status": { ...PAIRED_TS, paired: null } });
  const alerts = [];
  const r = await connectAfterSignIn(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => {}, { hud: true });
  assert.equal(r, "ok");
  assert.deepEqual(alerts, []);
});

test("a real failure shows Test Connection's alert for it", async () => {
  const native = phone([{ ok: false, code: "needs_approval", name: "box" }], { "idevice.status": PAIRED_TS });
  const alerts = [];
  const r = await connectAfterSignIn(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => {});
  assert.equal(r, "needs_approval");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, "Approve This Device");
  assert.ok(!native.calls.includes("idevice.verify"));
});

test("refused: B220's check forgets the pairing with its own alert, no second one", async () => {
  recheckHooks.goPair = () => {};
  const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing"), { code: "refused" });
  const native = phone([{ ok: false, code: "refused" }], { "idevice.status": PAIRED_TS, "idevice.verify": refused, "idevice.forget": {} });
  const alerts = [];
  const r = await connectAfterSignIn(native, async (a) => { alerts.push(a); return { index: 0 }; }, () => {});
  assert.equal(r, "repair");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /Pairing starts again/);
});

test("the sign-in waits for no Signed In tap; the setup page's sign-in runs no check", () => {
  const src = readFileSync(new URL("./installroute.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function tailscaleSignIn"), src.indexOf("// B219: right after a sign-in"));
  assert.doesNotMatch(body, /Signed In/);
  assert.doesNotMatch(body, /Tap Test Connection/);
  assert.match(body, /if \(from\) return;\s*await connectAfterSignIn/);
});
