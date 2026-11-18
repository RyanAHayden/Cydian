// N9: share.js, what the page does with cydian://shared?route=… (the shell's links, native/share/Share.swift).
// The routes that open sheets (the Install IPA console, the .deb Confirm sheet, My IPAs' install) need the DOM; here
// the alerts, the Cancel paths and the downloads' failures, with a fake bridge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleShared } from "./share.js";
import { handleIncoming } from "./incoming.js";

const fake = (answers = {}) => {
  const calls = [];
  return { calls, call: async (method, params) => { calls.push([method, params]); const a = answers[method]; if (a instanceof Error) throw a; return a ?? null; } };
};
const alerts = (index = 0) => { const seen = []; return { seen, alert: async (o) => { seen.push(o); return { index }; } }; };
const hud = () => () => {};

test("refuse: the shell's title and message in an alert", async () => {
  const a = alerts();
  const url = "cydian://shared?route=refuse&title=Needs%20a%20Jailbreak&message=A%20.deb%20is%20a%20jailbreak%20package.";
  assert.equal(await handleShared(url, { native: fake(), alert: a.alert, hud }), "refuse");
  assert.deepEqual(a.seen.map((o) => [o.title, o.message]), [["Needs a Jailbreak", "A .deb is a jailbreak package."]]);
});

test("helper-ipa: Cancel discards the staged file", async () => {
  const native = fake();
  const a = alerts(0);
  assert.equal(await handleShared("cydian://shared?route=helper-ipa&file=AB-1.ipa&name=Demo.ipa", { native, alert: a.alert, hud }), "helper-ipa");
  assert.equal(a.seen[0].title, "Install Demo.ipa?");
  assert.deepEqual(a.seen[0].buttons, ["Cancel", "Install"]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(native.calls, [["share.discard", { file: "AB-1.ipa", kind: "ipa" }]]);
});

test("sign-ipa and deb links: a failed download says so, nothing opens", async () => {
  const native = fake({ "library.add": Object.assign(new Error("network: offline"), { code: "network" }), "share.debFetch": new Error("not_deb: https://e.x/a.deb didn't give a Debian package") });
  const a = alerts();
  assert.equal(await handleShared("cydian://shared?route=sign-ipa&url=https%3A%2F%2Fe.x%2FApp.ipa", { native, alert: a.alert, hud }), "sign-ipa");
  assert.equal(await handleShared("cydian://shared?route=deb&url=https%3A%2F%2Fe.x%2Fa.deb", { native, alert: a.alert, hud }), "deb");
  assert.deepEqual(native.calls.map((c) => c[0]), ["library.add", "share.debFetch"]);
  assert.deepEqual(native.calls[0][1], { url: "https://e.x/App.ipa" });
  assert.deepEqual(a.seen.map((o) => o.title), ["Couldn't Download", "Couldn't Download"]);
  assert.equal(a.seen[1].message, "https://e.x/a.deb didn't give a Debian package");
});

test("incoming.js hands cydian://shared to share.js; anything else isn't one", async () => {
  const got = [];
  assert.equal(await handleIncoming("cydian://shared?route=refuse&title=T&message=M", { shared: async (u) => { got.push(u); } }), "shared");
  assert.deepEqual(got, ["cydian://shared?route=refuse&title=T&message=M"]);
  assert.equal(await handleShared("cydian://shared?route=nope", { native: fake(), alert: alerts().alert, hud }), null);
});
