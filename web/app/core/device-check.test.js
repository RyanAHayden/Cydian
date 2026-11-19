// F236: is this iPhone in the signing profile? Parsing ProvisionedDevices (one device, several, none, all devices),
// the check against this phone (its UDID, or the set its own embedded profile lists), and the sentences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseProfile, phoneFromDevices, deviceCheck, deviceCheckText, notInProfileText, unknownDeviceText,
  deviceSummary, deviceError, IN_PROFILE_TEXT, UDID_HOW, notLandedText, NOT_LANDED_TEXT, SENT_TO_IOS,
} from "./signing.js";

const SEVEN = "cb21a7f0caffd4807d41e713456f134cc958b076"; // the iPhone 7's, as its helper reads it
const NEW = "00008110-000A1B2C3D4E5F60";
const OTHER = "00008030-0011223344556677";

// A .mobileprovision as the parser sees it: a plist between CMS bytes.
function profile(extra) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Name</key><string>Test</string>
<key>TeamIdentifier</key><array><string>TEAM123456</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM123456.*</string></dict>
${extra}
</dict></plist>`;
  const body = new TextEncoder().encode(xml);
  const out = new Uint8Array(body.length + 64);
  out.set([0x30, 0x82, 0x10, 0x00], 0);
  out.set(body, 32);
  return out;
}
const devices = (...u) => `<key>ProvisionedDevices</key><array>${u.map((x) => `<string>${x}</string>`).join("")}</array>`;

test("parsing: one device, several, none, all devices", () => {
  const one = parseProfile(profile(devices(SEVEN)));
  assert.deepEqual(one.udids, [SEVEN]);
  assert.equal(one.devices, 1);
  const several = parseProfile(profile(devices(SEVEN, NEW, OTHER)));
  assert.deepEqual(several.udids, [SEVEN, NEW, OTHER]);
  const none = parseProfile(profile(""));
  assert.deepEqual(none.udids, []);
  assert.equal(none.allDevices, false);
  const all = parseProfile(profile("<key>ProvisionsAllDevices</key><true/>"));
  assert.deepEqual(all.udids, []);
  assert.equal(all.allDevices, true);
});

test("this phone from its own embedded profile: one is its UDID, several a set, none unknown", () => {
  assert.deepEqual(phoneFromDevices([SEVEN]), { udid: SEVEN.toUpperCase() });
  assert.deepEqual(phoneFromDevices([SEVEN, NEW]), { candidates: [SEVEN.toUpperCase(), NEW] });
  assert.deepEqual(phoneFromDevices([SEVEN, SEVEN.toUpperCase()]), { udid: SEVEN.toUpperCase() }, "the same UDID twice is one");
  assert.equal(phoneFromDevices([]), null);
  assert.equal(phoneFromDevices(undefined), null);
});

test("a known UDID: in the profile, or not", () => {
  const p = parseProfile(profile(devices(SEVEN, NEW)));
  const yes = deviceCheck(p, { udid: SEVEN.toUpperCase() }); // case doesn't matter
  assert.equal(yes.state, "in");
  assert.equal(yes.count, 2);
  const no = deviceCheck(p, { udid: OTHER });
  assert.deepEqual(no, { state: "out", udid: OTHER, count: 2, shared: 0 });
});

test("a set from the app's own profile: all shared is in, none shared is out, some is unknown", () => {
  const p = parseProfile(profile(devices(SEVEN, NEW)));
  assert.equal(deviceCheck(p, { candidates: [SEVEN, NEW] }).state, "in");
  assert.equal(deviceCheck(p, { candidates: [OTHER, "00008101-0000000000000001"] }).state, "out");
  const some = deviceCheck(p, { candidates: [SEVEN, OTHER] });
  assert.equal(some.state, "unknown");
  assert.equal(some.shared, 1);
});

test("no UDID: unknown, with the profile's device count", () => {
  const p = parseProfile(profile(devices(SEVEN, NEW, OTHER)));
  assert.deepEqual(deviceCheck(p, null), { state: "unknown", udid: null, count: 3, shared: 0 });
});

test("all devices (enterprise) and no device list skip the check", () => {
  assert.equal(deviceCheck(parseProfile(profile("<key>ProvisionsAllDevices</key><true/>")), { udid: SEVEN }).state, "skip");
  assert.equal(deviceCheck(parseProfile(profile("")), { udid: SEVEN }).state, "skip");
  assert.equal(deviceCheck({ udids: [SEVEN], devices: -1 }, { udid: OTHER }).state, "skip", "the shell's -1 is all");
  assert.equal(deviceCheckText(deviceCheck(parseProfile(profile("")), { udid: SEVEN })), null);
});

test("the sentences", () => {
  assert.equal(IN_PROFILE_TEXT, "This iPhone is in the profile.");
  assert.equal(notInProfileText(SEVEN),
    `This iPhone isn't in the profile: add its UDID ${SEVEN} to the developer account, then make the profile again.`);
  assert.match(notInProfileText(null), /^This iPhone isn't in the profile: add its UDID to the developer account/);
  assert.ok(notInProfileText(null).endsWith(UDID_HOW));
  assert.match(UDID_HOW, /Finder/);
  assert.match(UDID_HOW, /idevice_id -l/);
  assert.match(unknownDeviceText(3), /profile's 3 devices/);
  assert.match(unknownDeviceText(1), /profile's 1 device\./);

  const out = deviceCheckText({ state: "out", udid: OTHER, count: 2 });
  assert.equal(out.ok, false);
  assert.equal(out.udid, OTHER);
  assert.equal(out.text, notInProfileText(OTHER));
  assert.deepEqual(deviceCheckText({ state: "in", udid: SEVEN, count: 1 }), { ok: true, text: IN_PROFILE_TEXT, udid: SEVEN });
  const unk = deviceCheckText({ state: "unknown", count: 4 });
  assert.equal(unk.ok, null);
  assert.match(unk.text, /4 devices/);
});

test("an install nobody could check ends on the short help line; the UDID steps live in the guide", () => {
  assert.equal(NOT_LANDED_TEXT, "Not on the Home Screen?");
  for (const state of ["unknown", "out"]) assert.equal(notLandedText("Foo", { state, count: 2 }), NOT_LANDED_TEXT, state);
  for (const c of [{ state: "in", count: 2 }, { state: "skip", count: 0 }, null]) assert.equal(notLandedText("Foo", c), null);
  assert.equal(SENT_TO_IOS, "Sent to iOS. Press Home to watch it install.");
});

test("Settings > Signing: signing.status's profile.device as the page's line", () => {
  const ident = { name: "Apple Development: X", team: "T", profile: { name: "P", devices: 2, appId: "*", device: { state: "out", udid: OTHER, count: 2 } } };
  const s = deviceSummary(ident);
  assert.equal(s.device.ok, false);
  assert.equal(s.device.text, notInProfileText(OTHER));
  assert.equal(deviceSummary({ ...ident, profile: { ...ident.profile, device: undefined } }).device, null, "an older shell: no line");
});

test("an install refused before signing opens Signing with the shell's sentence", () => {
  const e = Object.assign(new Error(notInProfileText(OTHER)), { code: "device_not_in_profile" });
  const why = deviceError(e, "Some App");
  assert.equal(why.open, "signing");
  assert.equal(why.message, notInProfileText(OTHER));
});

// DeviceCheck.swift says the same sentences (signing.install's error, before iOS says its own).
test("the shell's sentences match", () => {
  const swift = readFileSync(new URL("../../../native/sign/DeviceCheck.swift", import.meta.url), "utf8");
  for (const s of [IN_PROFILE_TEXT, notInProfileText("\\(udid)"), UDID_HOW]) assert.ok(swift.includes(s), s);
  assert.ok(swift.includes("isn't in the profile: add its UDID to the developer account, then make the profile again. \\(how)"));
});
