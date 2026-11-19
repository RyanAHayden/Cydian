// B72: an IPA whose own MinimumOSVersion is above this iPhone's iOS (YouMod: YouTube 21.45.4 needs iOS 17.0, its
// AltStore source says 14.0) is caught before the download (screens/ipa-install.js ipaNeeds, through the Worker's
// /api/ipainfo), marked on the app page's Install row (markIpaNeeds), and the helper's own refusal gets a
// "Needs iOS" alert (core/ipainstall.js ipaError).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { installWithAppSync, ipaNeeds, markIpaNeeds, JAILBREAK_SUBTITLE } from "./ipa-install.js";
import { ipaError, needsNewerIos, needsIosText } from "../core/ipainstall.js";

const URL_ = "https://github.com/x/y/releases/download/v2/YouMod_2.0.0_21.45.4.ipa";
const FROM_IPA = { minOSVersion: "17.0", deviceFamily: [1, 2], from: "ipa", at: 1 };

test("needsNewerIos compares by number, and says no when either side isn't a version", () => {
  assert.equal(needsNewerIos("17.0", "15.8.8"), true);
  assert.equal(needsNewerIos("15.8.8", "15.8.8"), false);
  assert.equal(needsNewerIos("15.10", "15.9"), true);
  assert.equal(needsNewerIos("14", "15.8.8"), false);
  assert.equal(needsNewerIos("16.0", "16"), false);
  for (const [a, b] of [["", "15"], ["17", ""], [null, "15"], ["x", "15"], ["17", undefined]]) assert.equal(needsNewerIos(a, b), false);
  assert.equal(needsIosText("YouMod", "17.0", "15.8.8"), "YouMod needs iOS 17.0 or later; this iPhone has iOS 15.8.8.");
});

test("ipaNeeds: only the IPA's own answer counts, and only when this iPhone's iOS is known and too old", async () => {
  const check = (info) => async () => info;
  assert.deepEqual(await ipaNeeds(URL_, { ios: "15.8.8", check: check(FROM_IPA) }), { min: "17.0", ios: "15.8.8" });
  assert.equal(await ipaNeeds(URL_, { ios: "17.1", check: check(FROM_IPA) }), null);
  assert.equal(await ipaNeeds(URL_, { ios: null, check: check(FROM_IPA) }), null);
  assert.equal(await ipaNeeds(URL_, { ios: "15.8.8", check: check({ ...FROM_IPA, from: "appstore" }) }), null);
  assert.equal(await ipaNeeds(URL_, { ios: "15.8.8", check: check(null) }), null);
  assert.equal(await ipaNeeds(URL_, { ios: "15.8.8", check: async () => { throw new Error("offline"); } }), null);
  // A Worker that doesn't answer in time: the install goes on (the helper checks again)
  assert.equal(await ipaNeeds(URL_, { ios: "15.8.8", check: () => new Promise(() => {}), ms: 20 }), null);
});

test("installWithAppSync: a too-new IPA ends in one alert, with nothing downloaded and AppSync not touched", async () => {
  const order = [];
  const alerts = [];
  const r = await installWithAppSync({ url: URL_, name: "YouMod" }, {
    needs: async (u) => { order.push(`needs ${u}`); return { min: "17.0", ios: "15.8.8" }; },
    alert: async (a) => { alerts.push(a); return { index: 0 }; },
    ensure: async () => { order.push("ensure"); return { ok: true }; },
    run: async () => { order.push("run"); return { ok: true }; },
  });
  assert.deepEqual(r, { ok: false, needs: { min: "17.0", ios: "15.8.8" } });
  assert.deepEqual(order, [`needs ${URL_}`]);
  assert.deepEqual(alerts.map(({ title, message, buttons }) => [title, message, buttons]),
    [["Needs iOS 17.0", "YouMod needs iOS 17.0 or later; this iPhone has iOS 15.8.8.", ["OK"]]]);
  // Not too new (or unknown): AppSync, then the console, as before
  order.length = 0;
  const ok = await installWithAppSync({ url: URL_, name: "YouMod" }, {
    needs: async () => null, alert: async () => { throw new Error("no alert"); },
    ensure: async () => { order.push("ensure"); return { ok: true, present: true }; },
    run: async () => { order.push("run"); return { ok: true }; },
  });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(order, ["ensure", "run"]);
});

test("markIpaNeeds: the jailbreak Install row's subtitle says which iOS the IPA needs", async () => {
  const sub = (text) => ({ textContent: text, classList: { added: [], add(c) { this.added.push(c); } } });
  const rows = [sub(JAILBREAK_SUBTITLE), sub("YouMod_2.0.0_21.45.4.ipa")];
  const group = { querySelectorAll: (sel) => (sel === ".cell-subtitle" ? rows : []) };
  const n = await markIpaNeeds(group, URL_, { needs: async () => ({ min: "17.0", ios: "15.8.8" }) });
  assert.deepEqual(n, { min: "17.0", ios: "15.8.8" });
  assert.equal(rows[0].textContent, "Needs iOS 17.0 (this iPhone has 15.8.8)");
  assert.deepEqual(rows[0].classList.added, ["needs-ios"]);
  assert.equal(rows[1].textContent, "YouMod_2.0.0_21.45.4.ipa"); // Download IPA keeps its file name
  const untouched = [sub(JAILBREAK_SUBTITLE)];
  await markIpaNeeds({ querySelectorAll: () => untouched }, URL_, { needs: async () => null });
  assert.equal(untouched[0].textContent, JAILBREAK_SUBTITLE);
});

test("ipaError: the helper's MinimumOSVersion refusal and installd's own 'Have …; need …' are titled Needs iOS", () => {
  const e = ipaError(new Error("install: YouTube 21.45.4 needs iOS 17.0 or later (its MinimumOSVersion); this iPhone has iOS 15.8.8"), "YouMod");
  assert.equal(e.code, "os_version");
  assert.equal(e.title, "Needs iOS 17.0");
  assert.equal(e.message, "YouTube 21.45.4 needs iOS 17.0 or later (its MinimumOSVersion); this iPhone has iOS 15.8.8");
  const d = ipaError(new Error("install: installd refused the app: The system version is lower than the minimum OS version "
    + "specified for bundle at Payload/YouTube.app. Have 15.8.8; need 17.0"), "YouMod");
  assert.equal(d.title, "Needs iOS 17.0");
  assert.match(d.message, /^installd refused the app: The system version is lower/);
  // Any other installd refusal: installd's words after "iOS didn't install"
  const o = ipaError(new Error("install: installd refused the app: Failed to verify code signature"), "YouMod");
  assert.equal(o.code, "install");
  assert.equal(o.message, "iOS didn't install YouMod: installd refused the app: Failed to verify code signature");
});
