// B12: cancelling the vendor's sign-in sheet goes back to the package page without an alert; a callback the client
// can't read still shows one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { busyAction, vendorSignIn, CANCELLED } from "./extras.js";

function fakeClient({ finish = true } = {}) {
  const seen = [];
  return {
    seen,
    authenticateUrl: async () => "https://vendor.example/authenticate?udid=x",
    finishSignIn: async (cb) => { seen.push(cb); return finish; },
  };
}

function harness(job) {
  const log = [];
  const run = busyAction("Signing In", job, {
    hud: (label) => { log.push(`show ${label}`); return () => log.push("hide"); },
    fail: async (e) => { log.push(`alert ${e.message}`); },
    refresh: () => log.push("refresh"),
  });
  return { run, log };
}

test("B12: Cancel on the sign-in sheet (auth.session null) is CANCELLED: HUD down, no alert, no redraw", async () => {
  const client = fakeClient();
  const calls = [];
  const call = async (method, params) => { calls.push([method, params]); return null; };
  assert.equal(await vendorSignIn(client, call), CANCELLED);
  assert.deepEqual(calls, [["auth.session", { url: "https://vendor.example/authenticate?udid=x", callbackScheme: "sileo" }]]);
  assert.deepEqual(client.seen, [], "finishSignIn isn't asked about a sheet the user closed");
  const { run, log } = harness(() => vendorSignIn(client, call));
  await run();
  assert.deepEqual(log, ["show Signing In", "hide"]);
});

test("B12: a callback finishSignIn can't read still shows the Purchase alert", async () => {
  const client = fakeClient({ finish: false });
  const call = async () => "sileo://authentication_success?nonsense";
  await assert.rejects(vendorSignIn(client, call), /sent nothing back/);
  const { run, log } = harness(() => vendorSignIn(client, call));
  await run();
  assert.deepEqual(log, ["show Signing In", "hide", "alert The vendor sent nothing back that Cydian could read."]);
});

test("B12: a good sign-in draws the page again", async () => {
  const client = fakeClient();
  const { run, log } = harness(() => vendorSignIn(client, async () => "sileo://authentication_success?token=t&payment_secret=s"));
  await run();
  assert.deepEqual(log, ["show Signing In", "hide", "refresh"]);
  assert.equal(client.seen.length, 1);
});
