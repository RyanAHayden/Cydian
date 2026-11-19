// B64: only iFizBox's own job asks the app to host its signed IPA on the Signing Server (host: true, POST /sign/host);
// every other app installs from the phone's own 127.0.0.1 server. The app (native/Sources/Sideload.swift) keeps that
// choice with the call it came in (Sideload.Servers), so a job started later can't change an earlier one's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installCustom, resignApp } from "./queue.js";
import { SELF_ID } from "../core/appqueue.js";

const SELF_URL = "https://example.test/iFizBox.ipa";
const sc = () => {
  const s = { calls: [], isSelfIpa: (u) => u === SELF_URL, localSigning: () => true, getServer: () => "https://sign.example",
    installOnDevice: async (o) => { s.calls.push(o); return true; }, signAndInstall: async (o) => { s.calls.push({ ...o, self: true }); return true; } };
  return s;
};

test("Custom Install: host only for iFizBox's own IPA", async () => {
  const s = sc();
  await installCustom({ id: "com.x.a", url: "https://example.test/a.ipa", options: { edits: { name: "A" } } }, { sc: s, follow: () => {} });
  await installCustom({ id: SELF_ID, url: SELF_URL, options: { edits: {} } }, { sc: s, follow: () => {} });
  assert.equal("host" in s.calls[0], false);
  assert.equal(s.calls[1].host, true);
});

test("Re-sign: signing.resign sends host only for iFizBox's own record", async () => {
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { done: [p.bundleId], failed: [] }; } };
  const hud = () => ({ set() {}, hide() {}, done() {}, fail() {} });
  const follow = { native, hud, alert: async () => {} };
  await resignApp({ id: "com.x.a", name: "A", mode: "resign" }, { sc: sc(), ...follow }).catch(() => {});
  await resignApp({ id: SELF_ID, name: "Self", mode: "resign" }, { sc: sc(), ...follow }).catch(() => {});
  const resigns = calls.filter(([m]) => m === "signing.resign").map(([, p]) => p);
  assert.deepEqual(resigns[0], { bundleId: "com.x.a", manifestServer: "https://sign.example" });
  assert.deepEqual(resigns[1], { bundleId: SELF_ID, manifestServer: "https://sign.example", host: true });
});

test("Re-sign of a marked app (a url, no record): another app installs on the phone, unhosted", async () => {
  const s = sc();
  await resignApp({ id: "com.x.a", name: "A", url: "https://example.test/a.ipa", mode: "resign" }, { sc: s });
  assert.deepEqual(s.calls, [{ url: "https://example.test/a.ipa", name: "A" }]);
});
