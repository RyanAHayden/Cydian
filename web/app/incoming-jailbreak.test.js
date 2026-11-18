// B50: ifizbox://install?url=<ipa> in the jailbreak app. Its Install used to call signAndInstall, which has no signer
// there ("Can't Install Here"), so the IPA was never downloaded. Now Install goes to the helper (incoming.js
// defaultInstall -> screens/ipa-install.js openIpaInstall -> ipa.install), and the app is remembered by bundle id.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleIncoming, defaultInstall } from "./incoming.js";
import { signAndInstall } from "./signing-client.js";
import { runIpaInstall } from "./ipa-install.js";

const URL_ = "https://apps.example/Demo.ipa";

afterEach(() => { delete globalThis.ifizboxNative; });

test("jailbreak: Install runs the helper's IPA install with the link's name, and remembers what it installed", async () => {
  const opened = [];
  const kept = [];
  const run = await defaultInstall({ jailbreak: true,
    ipaInstall: async (o) => { opened.push(o); o.onInstalled({ ok: true, bundleId: "com.example.demo" }); return { ok: true }; },
    remember: async (r, name) => { kept.push([r.bundleId, name]); } });
  assert.notEqual(run, signAndInstall);
  await run({ url: URL_, name: "Demo App" });
  assert.deepEqual(opened.map(({ url, name }) => [url, name]), [[URL_, "Demo App"]]);
  assert.deepEqual(kept, [["com.example.demo", "Demo App"]]);
  await run({ url: URL_, name: "" }); // no name: the file's
  assert.deepEqual(kept[1], ["com.example.demo", "Demo"]);
});

test("not jailbreak: Install is still signAndInstall (the sideload app signs, the website signs in the browser)", async () => {
  assert.equal(await defaultInstall({ jailbreak: false }), signAndInstall);
  assert.equal(await defaultInstall(), signAndInstall); // no bridge: the website
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  assert.equal(await defaultInstall(), signAndInstall);
});

test("jailbreak bridge: defaultInstall picks the helper by itself", async () => {
  globalThis.ifizboxNative = { mode: "jailbreak", call: async () => null };
  assert.notEqual(await defaultInstall({ ipaInstall: async () => ({}), remember: async () => null }), signAndInstall);
});

test("jailbreak: the link's Install downloads through ipa.install (the bridge sees the IPA's URL)", async () => {
  const calls = [];
  const native = { mode: "jailbreak", async call(method, params) { calls.push([method, params]); return { code: 0, bundleId: "com.example.demo" }; } };
  globalThis.ifizboxNative = native;
  const view = { line() {}, status() {}, progress() {} };
  const install = await defaultInstall({
    ipaInstall: ({ url, name, onInstalled }) => runIpaInstall({ url, name }, view, { native }).then((r) => { if (r.ok) onInstalled(r); return r; }),
    remember: async () => null });
  const alerts = [];
  const r = await handleIncoming(`ifizbox://install?url=${encodeURIComponent(URL_)}&name=Demo`, {
    alert: async (a) => { alerts.push(a.title); return { index: 1 }; }, open: () => {}, install });
  assert.equal(r, "install");
  assert.deepEqual(alerts, ["Install IPA"]);
  assert.deepEqual(calls.map(([m, p]) => [m, p.url]), [["ipa.install", URL_]]);
});
