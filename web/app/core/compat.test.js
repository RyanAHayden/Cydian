import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compat, compatCode, badge, iosFromUserAgent, archNeed, iosRequirement, iosOk, isIncompatible, normalizeDevice,
  jailbreakOfArch,
} from "./compat.js";
import { parseControl } from "./apt.js";

const deb = (fields) => parseControl(Object.entries({ Package: "com.x", Version: "1", ...fields })
  .map(([k, v]) => `${k}: ${v}`).join("\n"))[0];
const rootless = (ios) => ({ ios, jailbreak: "rootless" });
const rootful = (ios) => ({ ios, jailbreak: "rootful" });

test("no firmware dependency: unknown, never hidden", () => {
  for (const st of [deb({ Architecture: "iphoneos-arm64" }), deb({ Architecture: "iphoneos-arm64", Depends: "mobilesubstrate, preferenceloader" }),
    deb({ Architecture: "all", Depends: "firmware" })]) {
    const v = compat(st, rootless("16.5"));
    assert.equal(v.status, "unknown");
    assert.equal(isIncompatible(compatCode(st, rootless("16.5"))), false);
  }
  assert.equal(badge("unknown"), "Unknown");
});

test("Depends: firmware (>= x)", () => {
  const st = deb({ Architecture: "iphoneos-arm64", Depends: "mobilesubstrate, firmware (>= 15.0)" });
  assert.equal(compat(st, rootless("16.5")).status, "works");
  assert.equal(compat(st, rootless("15.0")).status, "works");
  const no = compat(st, rootless("14.8"));
  assert.equal(no.status, "no");
  assert.equal(no.reason, "ios");
  assert.equal(no.label, "Not on iOS 14.8");
  assert.equal(no.range, "iOS 15.0 or later");
  assert.equal(badge("ios", rootless("14.8")), "Not on iOS 14.8");
});

test("Depends: firmware (<< y) and both bounds", () => {
  const below = deb({ Architecture: "iphoneos-arm64", Depends: "firmware (<< 17.0)" });
  assert.equal(compat(below, rootless("16.7.2")).status, "works");
  assert.equal(compat(below, rootless("17.0")).status, "no");
  assert.equal(compat(below, rootless("17.0")).range, "iOS below 17.0");
  const both = deb({ Architecture: "iphoneos-arm64", Depends: "firmware (>= 15.0), firmware (<< 17.0)" });
  assert.equal(compat(both, rootless("16.1")).status, "works");
  assert.equal(compat(both, rootless("14.4")).status, "no");
  assert.equal(compat(both, rootless("17.2")).status, "no");
  assert.equal(compat(both, rootless("16.1")).range, "iOS 15.0 to below 17.0");
  // dpkg version order: 16.5 < 16.5.1 < 16.10
  const patch = deb({ Architecture: "iphoneos-arm64", Depends: "firmware (>= 16.5.1)" });
  assert.equal(compat(patch, rootless("16.5")).status, "no");
  assert.equal(compat(patch, rootless("16.10")).status, "works");
});

test("Pre-Depends, alternatives and Conflicts on firmware", () => {
  assert.equal(compat(deb({ Architecture: "all", "Pre-Depends": "firmware (>= 16.0)" }), rootless("15.4")).status, "no");
  // every alternative firmware: one is enough
  const alt = deb({ Architecture: "all", Depends: "firmware (<< 13.0) | firmware (>= 15.0)" });
  assert.equal(compat(alt, rootless("16.0")).status, "works");
  assert.equal(compat(alt, rootless("14.0")).status, "no");
  // a non-firmware alternative: the group can't be judged, so it's ignored
  assert.equal(compat(deb({ Architecture: "all", Depends: "firmware (>= 17.0) | com.ex.shim" }), rootless("15.0")).status, "unknown");
  const conflicts = deb({ Architecture: "iphoneos-arm", Conflicts: "firmware (>= 15.0)" });
  assert.equal(compat(conflicts, rootful("14.3")).status, "works");
  assert.equal(compat(conflicts, rootful("15.1")).status, "no");
  assert.equal(compat(conflicts, rootful("15.1")).range, "iOS below 15.0");
  assert.equal(compat(deb({ Architecture: "all", Breaks: "firmware (<< 14.0)" }), rootless("13.5")).status, "no");
});

test("Architecture: rootless, rootful, roothide, all, none, odd", () => {
  assert.equal(archNeed(deb({ Architecture: "iphoneos-arm64" })), "rootless");
  assert.equal(archNeed(deb({ Architecture: "iphoneos-arm" })), "rootful");
  assert.equal(archNeed(deb({ Architecture: "iphoneos-arm64e" })), "roothide");
  assert.equal(archNeed(deb({ Architecture: "all" })), "any");
  assert.equal(archNeed(deb({})), "rootful"); // old repos: no Architecture means rootful
  const ful = deb({ Architecture: "iphoneos-arm", Depends: "firmware (>= 12.0)" });
  assert.equal(compat(ful, rootless("16.5")).label, "Rootful only");
  assert.equal(compatCode(ful, rootless("16.5")), "rootful");
  assert.equal(compatCode(ful, rootful("14.0")), "works");
  assert.equal(compatCode(deb({ Architecture: "iphoneos-arm64" }), rootful("14.0")), "rootless");
  assert.equal(compatCode(deb({ Architecture: "iphoneos-arm64e" }), rootless("16.0")), "roothide");
  assert.equal(compatCode(deb({ Architecture: "iphoneos-arm64e" }), { ios: "16.0", jailbreak: "roothide" }), "unknown");
  assert.equal(compatCode(deb({ Architecture: "iphoneos-arm64" }), { ios: "16.0", jailbreak: "roothide" }), "rootless");
  assert.equal(compatCode(deb({ Architecture: "all" }), rootful("9.3")), "unknown");
  assert.equal(compatCode(deb({ Architecture: "darwin-arm64" }), rootless("16.0")), "arch");
  assert.equal(badge("arch"), "Not for iPhone");
  // the wrong architecture is reported before the iOS version
  assert.equal(compatCode(deb({ Architecture: "iphoneos-arm", Depends: "firmware (<< 10.0)" }), rootless("16.0")), "rootful");
  assert.equal(badge("rootless"), "Rootless only");
  assert.equal(badge("roothide"), "Roothide only");
});

test("not jailbroken: debs need a jailbreak, apps don't", () => {
  const none = { ios: "17.4", jailbreak: "none" };
  assert.equal(compatCode(deb({ Architecture: "all" }), none), "jailbreak");
  assert.equal(badge("jailbreak"), "Jailbreak only");
  const app = { name: "App", bundleIdentifier: "com.ex.app", minOSVersion: "15.0" };
  assert.equal(compatCode(app, none), "works");
});

test("AltStore apps: minOSVersion / maxOSVersion", () => {
  const app = { name: "App", bundleIdentifier: "com.ex.app", minOSVersion: "15.0", maxOSVersion: "17" };
  assert.equal(archNeed(app), "any");
  assert.equal(compat(app, rootless("14.2")).status, "no");
  assert.equal(compat(app, rootless("15.0")).status, "works");
  assert.equal(compat(app, rootless("17.6.1")).status, "works"); // a max of "17" means any 17.x
  assert.equal(compat(app, rootless("18.0")).status, "no");
  assert.equal(compat(app, rootless("17.6.1")).range, "iOS 15.0 – 17");
  assert.equal(compat({ bundleIdentifier: "com.ex.b" }, rootless("16.0")).status, "unknown");
  // lower-cased fields (a stanza-shaped record) read the same
  assert.equal(compat({ bundleidentifier: "x", minosversion: "16.0" }, rootless("15.0")).status, "no");
});

test("unknown iOS version: a stated range is unknown, the architecture still counts", () => {
  const st = deb({ Architecture: "iphoneos-arm64", Depends: "firmware (>= 15.0)" });
  const v = compat(st, rootless(null));
  assert.equal(v.status, "unknown");
  assert.match(v.detail, /Settings/);
  assert.equal(compatCode(deb({ Architecture: "iphoneos-arm" }), rootless(null)), "rootful");
  assert.equal(compat(st, {}).status, "unknown"); // no device at all
});

test("iosRequirement and iosOk", () => {
  assert.deepEqual(iosRequirement(deb({ Depends: "a, b" })), { groups: [], conflicts: [], stated: false });
  const r = iosRequirement(deb({ Depends: "firmware (>= 14.0)" }));
  assert.equal(r.stated, true);
  assert.equal(iosOk(r, "14.0"), true);
  assert.equal(iosOk(r, "13.7"), false);
  assert.equal(iosOk(r, null), null);
});

test("the iOS version from the user agent", () => {
  assert.equal(iosFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"), "16.5");
  assert.equal(iosFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"), "15.7.1");
  assert.equal(iosFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "17.0");
  // Safari 26 freezes the OS part at 18_6; its Version is the iOS version
  assert.equal(iosFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1"), "26.1");
  assert.equal(iosFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 6_1_3 like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/6.0 Mobile/10B329 Safari/8536.25"), "6.1.3");
  assert.equal(iosFromUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), null);
  assert.equal(iosFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"), null);
  assert.equal(iosFromUserAgent(undefined), null);
});

test("normalizeDevice and jailbreakOfArch", () => {
  assert.deepEqual(normalizeDevice({ ios: " 16.5 ", jailbreak: "rootful" }), { ios: "16.5", jailbreak: "rootful" });
  assert.deepEqual(normalizeDevice({ ios: "auto", jailbreak: "weird" }), { ios: null, jailbreak: "rootless" });
  assert.deepEqual(normalizeDevice(null), { ios: null, jailbreak: "rootless" });
  assert.equal(jailbreakOfArch("iphoneos-arm"), "rootful");
  assert.equal(jailbreakOfArch("iphoneos-arm64"), "rootless");
  assert.equal(jailbreakOfArch(undefined), "rootless");
});

test("F35: the mark per verdict, and the reason under an incompatible name", async () => {
  const { markOf, needText } = await import("./compat.js");
  assert.equal(markOf("works"), "works");
  for (const code of ["ios", "rootful", "rootless", "roothide", "jailbreak", "arch"]) assert.equal(markOf(code), "no", code);
  assert.equal(markOf("unknown"), "unknown");
  assert.equal(markOf(null), null, "a row never judged gets no mark");
  assert.equal(markOf(undefined), null);
  const v = (fields, device) => needText(compat(deb(fields), device));
  assert.equal(v({ Architecture: "iphoneos-arm64", Depends: "firmware (<= 15)" }, rootless("16.5")), "Needs iOS 15 or earlier");
  assert.equal(v({ Architecture: "iphoneos-arm64", Depends: "firmware (>= 17.0)" }, rootless("16.5")), "Needs iOS 17.0 or later");
  assert.equal(v({ Architecture: "iphoneos-arm64", Depends: "firmware (<< 15.0)" }, rootless("16.5")), "Needs iOS older than 15.0");
  assert.equal(v({ Architecture: "iphoneos-arm" }, rootless("16.5")), "Needs a rootful jailbreak");
  assert.equal(v({ Architecture: "iphoneos-arm64" }, { ios: "16.5", jailbreak: "none" }), "Needs a jailbroken iPhone");
  assert.equal(v({ Architecture: "darwin-arm64" }, rootless("16.5")), "Built for darwin-arm64, not an iPhone");
  assert.equal(v({ Architecture: "iphoneos-arm64", Depends: "firmware (>= 15.0)" }, rootless("16.5")), null, "works: no reason");
  assert.equal(v({ Architecture: "iphoneos-arm64" }, rootless("16.5")), null, "unknown: no reason");
});
