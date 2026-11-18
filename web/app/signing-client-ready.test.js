// F69: Install signs straight away whenever Settings > Signing shows the certificate. Both go by statusReady over
// what signing.status answers (native/Sources/SignBridge.swift status()); these are its real shapes.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { signingReady, statusReady } from "./signing-client.js";

// SignBridge.status() with an identity and its profile, as the bridge hands it to the page (NSNull -> null).
const KEPT = {
  mode: "sideload",
  identity: {
    name: "Apple Development: Ryan (ABCDE12345)", team: "ABCDE12345", expires: "2027-11-17T00:00:00Z",
    signatureExpires: "2027-11-10T00:00:00Z", revocation: null,
    profile: { name: "Wildcard", team: "ABCDE12345", appId: "ABCDE12345.*", devices: 1, wildcard: true, expires: "2027-11-10T00:00:00Z", kind: "development" },
  },
  trust: { ca: false, trusted: false, name: "" },
};
const NONE = { mode: "sideload", identity: null, trust: { ca: false, trusted: false, name: "" } };
const LOST = { ...NONE, identityProblem: "The Keychain doesn't return the imported certificate with its key. Remove the certificate and import it again." };

function fakeNative(answers) {
  let i = 0;
  return {
    mode: "sideload",
    calls: 0,
    async call(method) {
      assert.equal(method, "signing.status");
      this.calls++;
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

let saved;
beforeEach(() => { saved = globalThis.cydianNative; });
afterEach(() => { globalThis.cydianNative = saved; });

test("statusReady: an identity object, with or without a name, with or without a profile, trusted or not", () => {
  assert.equal(statusReady(KEPT), true);
  assert.equal(statusReady({ ...KEPT, identity: { ...KEPT.identity, name: "" } }), true);
  assert.equal(statusReady({ ...KEPT, identity: { name: "X", team: "" } }), true); // no profile file
  assert.equal(statusReady({ ...KEPT, trust: { ca: true, trusted: true, name: "Cydian Local Install CA (iPhone 1A2B)" } }), true);
  assert.equal(statusReady(JSON.stringify(KEPT)), true); // the same as JSON text
});

test("statusReady: no identity, one the Keychain lost, or nothing usable", () => {
  for (const st of [NONE, LOST, null, undefined, {}, "", "not json", { identity: true }, { identity: [] }, { identity: "X" }]) {
    assert.equal(statusReady(st), false, JSON.stringify(st));
  }
});

test("signingReady in the sideload build follows statusReady", async () => {
  globalThis.cydianNative = fakeNative([KEPT]);
  assert.equal(await signingReady(), true);
  globalThis.cydianNative = fakeNative([NONE]);
  assert.equal(await signingReady({ wait: async () => {} }), false);
  globalThis.cydianNative = fakeNative([LOST]);
  assert.equal(await signingReady({ wait: async () => {} }), false);
});

test("a failed status call is tried once more before Install gives up on signing", async () => {
  const busy = Object.assign(new Error("busy"), { code: "internal" });
  let waited = 0;
  const n = fakeNative([busy, KEPT]);
  globalThis.cydianNative = n;
  assert.equal(await signingReady({ wait: async () => { waited++; } }), true);
  assert.equal(n.calls, 2);
  assert.equal(waited, 1);
  const dead = fakeNative([busy]);
  globalThis.cydianNative = dead;
  assert.equal(await signingReady({ wait: async () => {} }), false);
  assert.equal(dead.calls, 2);
});

test("a native bridge passed in is the one asked", async () => {
  delete globalThis.cydianNative;
  globalThis.cydianNative = { mode: "sideload", call: async () => { throw new Error("the global one"); } };
  assert.equal(await signingReady({ native: fakeNative([KEPT]), wait: async () => {} }), true);
});
