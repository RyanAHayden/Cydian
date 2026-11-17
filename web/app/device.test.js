import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceFrom, deviceLabel } from "./device.js";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1";

test("the site: the user agent's iOS version, unless Settings picks one; the jailbreak type from Architecture", () => {
  assert.deepEqual(deviceFrom({ userAgent: UA, arch: "iphoneos-arm64" }), { ios: "16.5", jailbreak: "rootless" });
  assert.deepEqual(deviceFrom({ userAgent: UA, setting: "15.4", arch: "iphoneos-arm" }), { ios: "15.4", jailbreak: "rootful" });
  assert.deepEqual(deviceFrom({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", arch: "iphoneos-arm64" }), { ios: null, jailbreak: "rootless" });
});

test("the app: the bridge's iOS version beats the user agent; the sideload build is not jailbroken", () => {
  assert.deepEqual(deviceFrom({ userAgent: UA, nativeIos: "17.0.3", arch: "iphoneos-arm64", mode: "jailbreak" }),
    { ios: "17.0.3", jailbreak: "rootless" });
  assert.equal(deviceFrom({ nativeIos: "17.0", mode: "sideload" }).jailbreak, "none");
});

test("the switch row's line under the label", () => {
  assert.equal(deviceLabel({ ios: "16.5", jailbreak: "rootless" }), "iOS 16.5 · Rootless");
  assert.equal(deviceLabel({ ios: null, jailbreak: "rootful" }), "iOS unknown · Rootful");
  assert.equal(deviceLabel({ ios: "17.0", jailbreak: "none" }), "iOS 17.0 · Not Jailbroken");
});

test("F37: the device type decides the jailbreak; Not Jailbroken is 'none' whatever the arch", () => {
  const UA16 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1";
  assert.deepEqual(deviceFrom({ userAgent: UA16, arch: "iphoneos-arm64", type: "none" }), { ios: "16.5", jailbreak: "none" });
  assert.deepEqual(deviceFrom({ userAgent: UA16, arch: "iphoneos-arm64", type: "iphoneos-arm" }), { ios: "16.5", jailbreak: "rootful" });
  assert.deepEqual(deviceFrom({ userAgent: UA16, arch: "iphoneos-arm", type: "iphoneos-arm64" }), { ios: "16.5", jailbreak: "rootless" });
  assert.deepEqual(deviceFrom({ userAgent: UA16, type: "iphoneos-arm64", mode: "sideload" }), { ios: "16.5", jailbreak: "none" });
});
