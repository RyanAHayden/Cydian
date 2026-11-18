// F69: the Signing walkthrough's step states (screens/signing.js stepStates) from signing.status answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepStates, allDone, STEPS } from "./signing.js";

const ident = { name: "Apple Development: Ryan (ABCDE12345)", team: "ABCDE12345" };
const st = (identity, trust) => ({ mode: "sideload", identity, trust });
const done = (states) => Object.fromEntries(states.map((s) => [s.id, s.done]));
const opened = (states) => states.filter((s) => s.open).map((s) => s.id);
const current = (states) => states.find((s) => s.current)?.id ?? null;

test("four numbered steps in order", () => {
  const s = stepStates(null);
  assert.deepEqual(s.map((x) => [x.n, x.id]), [[1, "certificate"], [2, "download"], [3, "install"], [4, "trust"]]);
  assert.deepEqual(s.map((x) => x.title), STEPS.map((x) => x.title));
});

test("nothing done: the signer didn't answer, or a fresh install", () => {
  for (const status of [null, undefined, st(null, { ca: false, trusted: false, name: "" })]) {
    const s = stepStates(status);
    assert.deepEqual(done(s), { certificate: false, download: false, install: false, trust: false });
    assert.equal(current(s), "certificate");
    assert.deepEqual(opened(s), ["certificate"]);
    assert.equal(allDone(s), false);
  }
});

test("certificate imported: step 1 ticks and step 2 opens", () => {
  const s = stepStates(st(ident, { ca: false, trusted: false }));
  assert.deepEqual(done(s), { certificate: true, download: false, install: false, trust: false });
  assert.deepEqual(opened(s), ["download"]);
});

test("a lost identity (identityProblem) is not a finished step 1", () => {
  const s = stepStates({ ...st(null, { ca: true, trusted: false }), identityProblem: "gone" });
  assert.equal(done(s).certificate, false);
  assert.equal(current(s), "certificate");
});

test("profile downloaded (the CA exists), not trusted yet: install is next", () => {
  const s = stepStates(st(ident, { ca: true, trusted: false, name: "Cydian Local Install CA (iPhone 1A2B)" }));
  assert.deepEqual(done(s), { certificate: true, download: true, install: false, trust: false });
  assert.equal(current(s), "install");
});

test("trusted: steps 3 and 4 tick together, all done, nothing open", () => {
  const s = stepStates(st(ident, { ca: true, trusted: true, name: "Cydian Local Install CA (iPhone 1A2B)" }));
  assert.deepEqual(done(s), { certificate: true, download: true, install: true, trust: true });
  assert.equal(current(s), null);
  assert.deepEqual(opened(s), []);
  assert.equal(allDone(s), true);
});

test("trusted before a certificate (done out of order): only step 1 is left", () => {
  const s = stepStates(st(null, { ca: true, trusted: true }));
  assert.deepEqual(done(s), { certificate: false, download: true, install: true, trust: true });
  assert.equal(current(s), "certificate");
});

test("the user's own expand and collapse taps win", () => {
  const status = st(ident, { ca: false, trusted: false });
  const s = stepStates(status, { open: { download: false, certificate: true, trust: true } });
  assert.deepEqual(opened(s), ["certificate", "trust"]);
  assert.equal(current(s), "download"); // still the next one to do
});
