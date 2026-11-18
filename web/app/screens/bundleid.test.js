// F129: installRows hands the app's own bundle ID (AltStore's bundleIdentifier, else the .ipa row's id) to
// signAndInstall, so a wildcard profile's website install opens iOS's prompt from the Install tap (F121's
// expectedBundleId). The website's gated Install on the Website, iFizBox's own Install, and the sideload app's Install.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows, appBundleId } from "./altstore.js";

const V = { version: "1.2", downloadURL: "https://example.com/My-Delta.ipa" };
const IFIZBOX = { version: "0.3.7", downloadURL: "https://github.com/RyanAHayden/Cydian/releases/download/v0.3.7/iFizBox.ipa" };

function rowsWith(version, opts) {
  const calls = [];
  const sign = async (o) => { calls.push(o); return true; };
  const out = installRows(version, null, () => {}, () => {}, null, "Delta", { custom: false, jailbreak: false, sign, ...opts });
  return { ...out, calls };
}

test("the website's Install on the Website signs with the app's bundle ID", async () => {
  let install = null;
  const gate = (o) => { install = o.install; return [o.download]; };
  const { calls } = rowsWith(V, { site: true, appId: "com.example.delta~delta", bundleId: "com.example.delta", gate });
  await install();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bundleId, "com.example.delta");
  assert.equal(calls[0].version, "1.2");
  assert.equal(calls[0].url, V.downloadURL);
});

test("iFizBox's own website Install and the sideload app's Install pass it too", async () => {
  const own = rowsWith(IFIZBOX, { site: true, bundleId: "com.ryha.ifizbox" });
  await own.rows[0].onClick();
  assert.equal(own.calls[0].bundleId, "com.ryha.ifizbox");
  const side = rowsWith(V, { site: false, bundleId: "com.example.delta" });
  await side.rows[0].onClick();
  assert.equal(side.calls[0].bundleId, "com.example.delta");
});

test("without a bundle ID it passes null, as before", async () => {
  const { rows, calls } = rowsWith(V, { site: false });
  await rows[0].onClick();
  assert.equal(calls[0].bundleId, null);
});

test("appBundleId: bundleIdentifier first, else the row id without its ~name suffix", () => {
  assert.equal(appBundleId({ bundleIdentifier: "com.example.delta" }, "com.example.delta~delta-2"), "com.example.delta");
  assert.equal(appBundleId(null, "com.example.delta~delta-2"), "com.example.delta");
  assert.equal(appBundleId(undefined, "com.example.app"), "com.example.app");
  assert.equal(appBundleId(null, null), null);
});
