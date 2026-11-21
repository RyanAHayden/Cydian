// B246: Tailscale reaches iOS but iOS has no RemotePairing pairing (remotepairingd resets the connection: "no hosts
// being paired"). Test Connection says to pair, with a Pair button, instead of "No Answer"; after a sign-in it isn't
// tried again for 30 s.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";
import { tailscaleTestResult } from "../core/installroute.js";

globalThis.document = fakeDocument();
const { testUntilConnected, connectAfterSignIn, AFTER_SIGN_IN, recheckHooks, hudHooks } = await import("./installroute.js");
hudHooks.show = () => () => {};
hudHooks.delay = 0;
recheckHooks.retryMs = 5;
AFTER_SIGN_IN.gapMs = 5;
AFTER_SIGN_IN.budgetMs = 1000;

const NOT_PAIRED = { ok: false, code: "not_paired", paired: false, detail: "read tcp 100.81.244.3:29582: connection reset by peer" };

test("not_paired is Not Paired Yet with a Pair button, not No Answer", () => {
  const why = tailscaleTestResult(NOT_PAIRED);
  assert.equal(why.title, "Not Paired Yet");
  assert.equal(why.pair, true);
  assert.match(why.message, /Tailscale reached this iPhone/);
  assert.doesNotMatch(why.message, /reset by peer/);
  const again = tailscaleTestResult({ ...NOT_PAIRED, paired: true });
  assert.equal(again.title, "Pair Again");
  assert.equal(again.pair, true);
  assert.equal(tailscaleTestResult({ ok: false, code: "no_answer" }).title, "No Answer", "a real silence still says so");
});

test("after a sign-in, not_paired ends the retries at once and Pair opens the pairing page", async () => {
  let n = 0;
  const native = { call: (m) => (m === "tailscale.test" ? (n++, Promise.resolve(NOT_PAIRED)) : Promise.resolve({})) };
  const r = await testUntilConnected(native);
  assert.equal(r.code, "not_paired");
  assert.equal(n, 1);

  let went = 0;
  const goPair = recheckHooks.goPair;
  recheckHooks.goPair = () => { went++; };
  try {
    const alerts = [];
    const how = await connectAfterSignIn(native, async (a) => { alerts.push(a); return { index: 1 }; }, () => {});
    assert.equal(how, "not_paired");
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0].buttons, ["Not Now", "Pair"]);
    assert.equal(went, 1, "Pair opens the pairing page");
  } finally { recheckHooks.goPair = goPair; }
});
