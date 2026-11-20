// F160: apps whose source gives no iOS range: the "unchecked" mark until the page reads the IPA, the merge of what the
// IPA says into compat (the source's fields win), what is kept on the device, the fallbacks, and the catalog's rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memoryStore } from "../fakes.test-helper.js";
import { needsCheck, ipaInfoUrl, textMinOS, withIpaInfo, ipaRaises, savedInfo, allSaved, checkIpa, createQueue, clearIpaMemory,
  UNKNOWN_TTL, GUESS_TTL } from "./ipainfo.js";
import { compat, compatCode, markOf, isIncompatible, badge, needText } from "./compat.js";
import { createCatalog, ALL } from "./catalog.js";
import { ipaCheck } from "../screens/altstore.js";

const IPA = "https://github.com/a/b/releases/download/v1/App.ipa";
const iphone = (ios) => ({ ios, jailbreak: "none" });
const app = (extra = {}) => ({ package: "com.ex.app", kind: "ipa", downloadURL: IPA, ...extra });

test("which versions need a check, and the Worker's URL", () => {
  assert.equal(needsCheck({ downloadURL: IPA }), true);
  assert.equal(needsCheck({ downloadURL: IPA, minOSVersion: "15.0" }), false);
  assert.equal(needsCheck({ downloadURL: IPA, maxOSVersion: "17" }), true); // only a max: the IPA gives the min
  assert.equal(needsCheck({ downloadURL: "itms-services://?action=download-manifest&url=x" }), false);
  assert.equal(needsCheck({}), false);
  assert.equal(ipaInfoUrl(IPA), `/api/ipainfo?url=${encodeURIComponent(IPA)}`);
  assert.equal(ipaInfoUrl(IPA, "https://ifizbox.com"), `https://ifizbox.com/api/ipainfo?url=${encodeURIComponent(IPA)}`);
  assert.equal(ipaInfoUrl("javascript:x"), null);
});

test("iOS versions stated in a description", () => {
  assert.equal(textMinOS("Works great. iOS 15+ only."), "15.0");
  assert.equal(textMinOS("Requires iOS 14.0 or newer"), "14.0");
  assert.equal(textMinOS("requires at least iOS 13.4"), "13.4");
  assert.equal(textMinOS("Supports iOS 16 and later"), "16.0");
  assert.equal(textMinOS("Minimum iOS: 12"), "12.0");
  assert.equal(textMinOS("Minimum version - iOS 15.1"), "15.1");
  assert.equal(textMinOS("iOS 14 - latest"), "14.0");
  assert.equal(textMinOS("New in this version: iOS 17 widgets"), null); // a bare mention says nothing
  assert.equal(textMinOS("iOS 999+"), null);
  assert.equal(textMinOS(""), null);
  assert.equal(textMinOS(null), null);
});

test("unchecked until the IPA is read; then the IPA's range judges it, and the source's own range wins", () => {
  const st = app();
  assert.equal(compat(st, iphone("16.5")).status, "unchecked");
  assert.equal(compatCode(st, iphone("16.5")), "unchecked");
  assert.equal(markOf("unchecked"), "unchecked");
  assert.equal(isIncompatible("unchecked"), false); // never hidden by Works on My Phone
  assert.equal(badge("unchecked"), "Not Checked");
  assert.equal(compatCode(app({ downloadURL: undefined }), iphone("16.5")), "unknown"); // nothing to read: today's ?
  assert.equal(compatCode({ package: "x", architecture: "iphoneos-arm64", downloadURL: IPA }, { ios: "16.5", jailbreak: "rootless" }), "unknown"); // a deb isn't
  const read = { minOSVersion: "17.0", deviceFamily: [1, 2], from: "ipa", at: 1 };
  assert.equal(compatCode(withIpaInfo(st, read), iphone("16.5")), "ios");
  assert.equal(compatCode(withIpaInfo(st, read), iphone("17.1")), "works");
  assert.equal(compat(withIpaInfo(st, read), iphone("17.1")).range, "iOS 17.0 or later");
  // the source's minOSVersion wins over a lower IPA value and over guesses; B74: an IPA's own higher value wins over it
  assert.equal(compatCode(withIpaInfo(app({ minOSVersion: "15.0" }), { ...read, minOSVersion: "13.0" }), iphone("14.5")), "ios");
  assert.equal(compatCode(withIpaInfo(app({ minOSVersion: "15.0" }), { ...read, from: "appstore" }), iphone("16.5")), "works");
  assert.equal(compatCode(withIpaInfo(app({ minOSVersion: "15.0" }), { ...read, from: "text" }), iphone("16.5")), "works");
  assert.equal(compatCode(withIpaInfo(app({ minOSVersion: "15.0" }), read), iphone("16.5")), "ios");
  // checked but unknown (the Range was refused): the filled grey ?, not the outlined one
  const none = { minOSVersion: null, deviceFamily: null, from: null, at: 1 };
  assert.equal(compatCode(withIpaInfo(st, none), iphone("16.5")), "unknown");
  assert.equal(markOf(compatCode(withIpaInfo(st, none), iphone("16.5"))), "unknown");
  assert.equal(withIpaInfo(st, null), st);
});

test("iPad-only (UIDeviceFamily without 1) is not for iPhone", () => {
  const pad = withIpaInfo(app(), { minOSVersion: "15.0", deviceFamily: [2], from: "ipa", at: 1 });
  const v = compat(pad, iphone("16.5"));
  assert.equal(v.status, "no");
  assert.equal(v.reason, "ipad");
  assert.equal(v.label, "Not for iPhone");
  assert.equal(badge("ipad"), "Not for iPhone");
  assert.equal(needText(v), "Made for iPad only");
  assert.equal(isIncompatible("ipad"), true);
  assert.equal(compatCode(withIpaInfo(app(), { minOSVersion: "15.0", deviceFamily: [1], at: 1 }), iphone("16.5")), "works");
});

test("kept on the device by downloadURL; expired entries are gone", () => {
  const store = memoryStore();
  store.setItem("ifizbox.ipainfo." + IPA, JSON.stringify({ minOSVersion: "15", deviceFamily: [1], from: "ipa", at: 5 }));
  store.setItem("ifizbox.ipainfo.https://x/old.ipa", JSON.stringify({ minOSVersion: null, from: null, at: 1, until: 10 }));
  store.setItem("ifizbox.ipainfo.https://x/bad.ipa", "{nope");
  store.setItem("ifizbox.other", "1");
  assert.deepEqual(savedInfo(store, IPA, 100), { minOSVersion: "15.0", deviceFamily: [1], from: "ipa", at: 5 });
  assert.equal(savedInfo(store, "https://x/old.ipa", 100), null);
  assert.deepEqual(Object.keys(allSaved(store, 100)), [IPA]);
  assert.deepEqual(allSaved(null), {});
});

test("checkIpa: the IPA's answer is kept for good, and asked only once", async () => {
  clearIpaMemory();
  const store = memoryStore();
  const asked = [];
  const get = async (u) => { asked.push(u); return { minOSVersion: "16.0", deviceFamily: [1, 2], bundleId: "com.ex.app", version: "1" }; };
  const fallback = () => { throw new Error("not asked while the IPA answers"); };
  const [a, b] = await Promise.all([checkIpa(IPA, { get, store, fallback, now: 1000 }), checkIpa(IPA, { get, store, fallback, now: 1000 })]);
  assert.deepEqual(a, { minOSVersion: "16.0", deviceFamily: [1, 2], from: "ipa", at: 1000 });
  assert.deepEqual(b, a);
  assert.equal(asked.length, 1, "two asks at once share one request");
  assert.deepEqual(await checkIpa(IPA, { get, store, now: 9e12 }), a); // kept: no until
  assert.equal(asked.length, 1);
});

test("checkIpa: a lasting failure falls back on the App Store, then the description; unknown is kept a month", async () => {
  clearIpaMemory();
  const store = memoryStore();
  const refused = async () => ({ code: "no_range", error: "no" });
  let r = await checkIpa("https://x/1.ipa", { get: refused, store, fallback: async () => "15.0", text: "iOS 13+", now: 0 });
  assert.equal(r.minOSVersion, "15.0");
  assert.equal(r.from, "appstore"); // the App Store's before the description's
  assert.equal(r.until, undefined);
  r = await checkIpa("https://x/2.ipa", { get: refused, store, fallback: async () => null, text: "Requires iOS 14", now: 0 });
  assert.deepEqual([r.minOSVersion, r.from], ["14.0", "text"]);
  r = await checkIpa("https://x/3.ipa", { get: refused, store, now: 0 });
  assert.deepEqual([r.minOSVersion, r.from, r.until], [null, null, UNKNOWN_TTL]);
  assert.ok(savedInfo(store, "https://x/3.ipa", 0), "checked but unknown is kept");
  assert.equal(savedInfo(store, "https://x/3.ipa", UNKNOWN_TTL + 1), null, "and asked again a month later");
});

test("checkIpa: a network failure isn't kept, unless a fallback found something (kept a day)", async () => {
  clearIpaMemory();
  const store = memoryStore();
  const down = async () => { throw new Error("offline"); };
  let r = await checkIpa("https://x/4.ipa", { get: down, store, now: 0 });
  assert.deepEqual([r.minOSVersion, r.from], [null, null]);
  assert.equal(savedInfo(store, "https://x/4.ipa", 0), null);
  r = await checkIpa("https://x/5.ipa", { get: async () => ({ code: "upstream" }), store, text: "iOS 15.0 or later", now: 0 });
  assert.equal(r.until, GUESS_TTL);
  assert.equal(savedInfo(store, "https://x/5.ipa", GUESS_TTL + 1), null);
  assert.equal(await checkIpa("not a url", { get: down }), null);
});

test("the queue runs a few checks at a time", async () => {
  const run = createQueue(2);
  let now = 0, most = 0;
  const job = () => run(async () => { now++; most = Math.max(most, now); await new Promise((r) => setTimeout(r, 5)); now--; return 1; });
  const out = await Promise.all([job(), job(), job(), job(), job()]);
  assert.deepEqual(out, [1, 1, 1, 1, 1]);
  assert.equal(most, 2);
  await assert.rejects(run(async () => { throw new Error("x"); }));
  assert.equal(await run(async () => 7), 7, "a failure doesn't stop the queue");
});

test("the website asks its own Worker, the app asks ifizbox.com", async () => {
  clearIpaMemory();
  const seen = [];
  const fetchFn = async (u) => { seen.push(u); return { json: async () => ({ minOSVersion: "15.0", deviceFamily: [1] }) }; };
  assert.equal((await ipaCheck("https://x/6.ipa", { backend: { kind: "http" }, fetchFn })).minOSVersion, "15.0");
  await ipaCheck("https://x/7.ipa", { backend: { kind: "native" }, fetchFn });
  assert.deepEqual(seen, [`/api/ipainfo?url=${encodeURIComponent("https://x/6.ipa")}`, `https://ifizbox.com/api/ipainfo?url=${encodeURIComponent("https://x/7.ipa")}`]);
});

test("the catalog judges rows with what IPAs said (setIpaInfo), only apps whose source gives no range", () => {
  const c = createCatalog();
  const json = { name: "Testers", apps: [
    { name: "NoRange", bundleIdentifier: "com.ex.none", versions: [{ version: "1", downloadURL: "https://x/none.ipa" }] },
    { name: "Pad", bundleIdentifier: "com.ex.pad", versions: [{ version: "1", downloadURL: "https://x/pad.ipa" }] },
    { name: "Ranged", bundleIdentifier: "com.ex.ranged", versions: [{ version: "1", downloadURL: "https://x/ranged.ipa", minOSVersion: "14.0" }] },
  ] };
  c.loadAlt("alt:https://x/src.json", json, "16.5");
  c.setDevice({ ios: "16.5", jailbreak: "none" }, { filter: false });
  const code = (id) => c.list(ALL, ALL).find((r) => r.id === id).compat;
  assert.equal(code("com.ex.none"), "unchecked");
  assert.equal(code("com.ex.ranged"), "works");
  c.setIpaInfo({ "https://x/none.ipa": { minOSVersion: "17.0", deviceFamily: [1], from: "ipa", at: 1 },
    "https://x/pad.ipa": { minOSVersion: "15.0", deviceFamily: [2], from: "ipa", at: 1 },
    "https://x/ranged.ipa": { minOSVersion: "13.0", from: "ipa", at: 1 } });
  assert.equal(code("com.ex.none"), "ios");
  assert.equal(code("com.ex.pad"), "ipad");
  assert.equal(code("com.ex.ranged"), "works"); // the source's 14.0 wins over the IPA's lower 13.0
  c.setDevice({ ios: "16.5", jailbreak: "none" }, { filter: true });
  assert.deepEqual(c.list(ALL, ALL).map((r) => r.id), ["com.ex.ranged"]); // what can't work drops out, as F17's
  // a source loaded after the results came in is judged with them too
  c.loadAlt("alt:https://y/src.json", { name: "Other", apps: [{ name: "Again", bundleIdentifier: "com.ex.again", versions: [{ version: "2", downloadURL: "https://x/none.ipa" }] }] }, "16.5");
  assert.equal(c.package("com.ex.again", "alt:https://y/src.json").row.compat, "ios");
});

test("B74: an IPA whose own MinimumOSVersion is above the source's is judged by the IPA (rows and setIpaInfo)", () => {
  const read = { minOSVersion: "17.0", deviceFamily: [1, 2], from: "ipa", at: 1 };
  const yt = app({ minOSVersion: "14.0" });
  assert.equal(ipaRaises(yt, read), true);
  assert.equal(ipaRaises(yt, { ...read, minOSVersion: "14.0" }), false); // the same: nothing to raise
  assert.equal(ipaRaises(yt, { ...read, minOSVersion: "13.4" }), false);
  assert.equal(ipaRaises(yt, { ...read, from: "appstore" }), false);      // a guess never beats the source
  assert.equal(ipaRaises(app(), read), false);                             // no source value: F160's fill, not a raise
  assert.equal(ipaRaises(yt, null), false);
  const v = withIpaInfo(yt, read);
  assert.equal(v.minOSVersion, "17.0");
  assert.equal(v.ipaFrom, "ipa");
  assert.equal(compat(v, iphone("15.8.8")).status, "no");
  assert.equal(needText(compat(v, iphone("15.8.8"))), needText(compat(app({ minOSVersion: "17.0" }), iphone("15.8.8"))));
  assert.equal(withIpaInfo(app({ minOSVersion: "14.0", maxOSVersion: "18" }), read).maxOSVersion, "18"); // the max stays

  const c = createCatalog();
  c.loadAlt("alt:https://x/youmod.json", { name: "YouMod Repo", apps: [
    { name: "YouTube", bundleIdentifier: "com.google.ios.youtube", versions: [{ version: "21.45.4", downloadURL: "https://x/yt.ipa", minOSVersion: "14.0" }] },
  ] }, "15.8.8");
  c.setDevice({ ios: "15.8.8", jailbreak: "rootless" }, { filter: false });
  const code = () => c.list(ALL, ALL).find((r) => r.id === "com.google.ios.youtube").compat;
  assert.equal(code(), "works");
  c.setIpaInfo({ "https://x/yt.ipa": read });
  assert.equal(code(), "ios");
});
