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

// B13: Chariz answers {"price":"FREE","purchased":true,"available":true} for betterAlarm without a token.
import { priceDetail } from "./extras.js";

test("B13: a free commercial package says Free, signed in or out, whatever `purchased` says", () => {
  for (const price of ["FREE", "free", " Free "]) {
    assert.equal(priceDetail({ price, purchased: true, available: true }, false), "Free");
    assert.equal(priceDetail({ price, purchased: true, available: true }, true), "Free");
    assert.equal(priceDetail({ price, purchased: false, available: true }, false), "Free");
  }
});

test("B13: Purchased only for a signed-in account; signed out shows the price", () => {
  assert.equal(priceDetail({ price: "$1.99", purchased: true, available: true }, true), "Purchased");
  assert.equal(priceDetail({ price: "$1.99", purchased: true, available: true }, false), "$1.99");
  assert.equal(priceDetail({ price: "$1.99", purchased: false, available: true }, true), "$1.99");
  assert.equal(priceDetail({ price: null, purchased: false, available: true }, false), "Paid");
});
