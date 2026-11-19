// F237: Keep Bundle IDs. The ID and entitlement choice per profile kind and option (both signers' rules: core/websign.js
// signingIds, core/keepid.js keepPlan), the warnings, the guide link, the bridge params, the website's job (no -b,
// the profile's App ID in the entitlements), Custom Install's params and the queue's library job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepPlan, profileFacts, profileNotes, originalNote, sheetNotes, originalState, withKeep, storedKeep, keepOn,
  OLD_WAY_ALERT, GUIDE_ID, GUIDE_ROUTE } from "./keepid.js";
import { signingIds, profileInfo, plistXml } from "./websign.js";
import { installParams, installedId, signsAsFor, parseProfile } from "./signing.js";
import { libraryJob } from "./appqueue.js";
import { SETTINGS } from "./settings.js";
import { runSignJob } from "../websign-job.js";
import { parsePlist } from "./signing.js";

const ADHOC_PUSH = { appId: "com.you.youtube", push: "production", kind: "Ad Hoc", wildcard: false };
const ADHOC = { appId: "com.you.youtube", push: null, kind: "Ad Hoc", wildcard: false };
const DEV = { appId: "com.you.youtube", push: "development", kind: "Development", wildcard: false };
const PREFIX = { appId: "com.you.*", push: null, kind: "Ad Hoc", wildcard: true };
const ALL = { appId: "*", push: null, kind: "Development", wildcard: true };
const ids = (n) => n.map((x) => x.id);

test("signingIds / keepPlan: kept, Info.plist keeps the app's ID and the entitlements get the profile's App ID", () => {
  assert.deepEqual(signingIds("com.you.youtube", "com.google.ios.youtube"), { bundleId: "com.google.ios.youtube", entitlementsId: "com.you.youtube" });
  assert.deepEqual(signingIds("com.you.*", "com.google.ios.youtube"), { bundleId: "com.google.ios.youtube", entitlementsId: "com.you.youtube" });
  assert.deepEqual(signingIds("com.you.*", "com.you.tool"), { bundleId: "com.you.tool", entitlementsId: "com.you.tool" });
  assert.deepEqual(signingIds("*", "io.dev.delta"), { bundleId: "io.dev.delta", entitlementsId: "io.dev.delta" });
  // off: the old way, the app becomes the profile's ID
  assert.deepEqual(signingIds("com.you.youtube", "com.google.ios.youtube", { keep: false }), { bundleId: "com.you.youtube", entitlementsId: "com.you.youtube" });
  assert.deepEqual(signingIds("com.you.*", "io.dev.delta", { keep: false }), { bundleId: "com.you.delta", entitlementsId: "com.you.delta" });
  for (const p of [ADHOC_PUSH, ADHOC, DEV, PREFIX]) {
    const k = keepPlan(p, "com.google.ios.youtube");
    assert.equal(k.bundleId, "com.google.ios.youtube", p.kind);
    assert.equal(k.entitlementsId, "com.you.youtube", p.kind);
    assert.equal(keepPlan(p, "com.google.ios.youtube", { keep: false }).bundleId, "com.you.youtube", p.kind);
  }
});

test("profileNotes per profile kind: what it can't do with the ID kept, and the guide link", () => {
  assert.deepEqual(ids(profileNotes(ADHOC_PUSH)), ["one-app"], "an Ad Hoc profile with Push: only the one-app reminder");
  assert.deepEqual(ids(profileNotes(ADHOC)), ["no-push", "one-app"]);
  assert.deepEqual(ids(profileNotes(DEV)), ["development", "one-app"]);
  assert.deepEqual(ids(profileNotes(PREFIX)), ["wildcard"]);
  assert.deepEqual(ids(profileNotes(ALL)), ["wildcard"]);
  assert.match(profileNotes(PREFIX, { name: "YouTube" })[0].text, /wildcard \(com\.you\.\*\).*YouTube keeps its ID but won't get notifications/);
  assert.match(profileNotes(DEV)[0].text, /test servers/);
  assert.match(profileNotes(ADHOC)[0].text, /doesn't have Push/);
  for (const p of [ADHOC, DEV, PREFIX]) assert.equal(profileNotes(p)[0].guide, true, "links the guide");
  assert.equal(profileNotes(ADHOC_PUSH)[0].guide, false);
  // off: one plain warning, whatever the profile
  const off = profileNotes(ADHOC_PUSH, { keep: false, name: "YouTube", as: "com.you.youtube" });
  assert.deepEqual(ids(off), ["old-way"]);
  assert.match(off[0].text, /YouTube becomes a separate copy under your ID \(com\.you\.youtube\).*notifications won't work.*sign-in, iCloud/);
  assert.match(OLD_WAY_ALERT.message, /separate copy.*notifications won't work/);
  assert.deepEqual(GUIDE_ROUTE, ["guides", GUIDE_ID]);
});

test("profileFacts reads signing.status, signing.inspect and the website's parsed profile alike", () => {
  assert.deepEqual(profileFacts({ appId: "com.you.*", wildcard: true, kind: "Ad Hoc", push: null }), PREFIX);
  assert.deepEqual(profileFacts({ profileAppId: "com.you.youtube", profileKind: "Ad Hoc", push: "production", wildcard: false }), ADHOC_PUSH);
  assert.deepEqual(profileFacts({ appId: "com.you.youtube", getTaskAllow: true, devices: 2, push: "development" }), DEV);
  assert.equal(profileFacts(null), null);
});

test("the original app on the phone: warned unless iFizBox signed that copy; not when the old way makes a copy", async () => {
  assert.equal(originalNote("YouTube", { installed: false }), null);
  assert.equal(originalNote("YouTube", { installed: true, ours: true }), null);
  assert.match(originalNote("YouTube", { installed: true }).text, /YouTube is already on this iPhone.*replaces it.*App Store copy: delete that one first/);
  const info = { app: { name: "YouTube", bundleId: "com.google.ios.youtube" }, profileAppId: "com.you.youtube", push: "production",
    profileKind: "Ad Hoc", wildcard: false, appIdAs: "com.you.youtube" };
  assert.deepEqual(ids(sheetNotes(info, { installed: true }).notes), ["original", "one-app"]);
  assert.deepEqual(ids(sheetNotes(info, { keep: false, installed: true }).notes), ["old-way"]);
  assert.equal(sheetNotes({ ...info, push: null }).guide, true);
  const calls = [];
  const native = { call: async (m, p) => { calls.push(m); return m === "apps.isInstalled" ? { installed: { [p.bundleIds[0]]: true } } : { apps: [{ bundleId: "x" }] }; } };
  assert.deepEqual(await originalState(native, "com.google.ios.youtube"), { installed: true, ours: false });
  assert.deepEqual(calls, ["apps.isInstalled", "signing.installed"]);
  assert.deepEqual(await originalState({ call: async () => { throw new Error("no"); } }, "a.b"), { installed: false, ours: false });
  assert.deepEqual(await originalState(null, "a.b"), { installed: false, ours: false });
});

test("the setting: on by default, both signing builds; withKeep sends false only when off, a job's choice wins", () => {
  const d = SETTINGS.find((x) => x.key === "keepBundleId");
  assert.equal(d.default, true);
  assert.equal(d.kind, "toggle");
  assert.deepEqual(d.modes, ["site", "sideload"]);
  assert.equal(d.confirmOff, OLD_WAY_ALERT, "turning it off asks first");
  const store = (v) => ({ getItem: (k) => (k === "ifizbox.keepBundleId" ? v : null) });
  assert.equal(storedKeep(store(null)), true);
  assert.equal(storedKeep(store("true")), true);
  assert.equal(storedKeep(store("false")), false);
  assert.equal(storedKeep({ getItem: () => { throw new Error("private"); } }), true);
  assert.equal(keepOn(() => false), false);
  assert.equal(keepOn(() => true), true);
  assert.deepEqual(withKeep({ url: "u" }, true), { url: "u" });
  assert.deepEqual(withKeep({ url: "u" }, false), { url: "u", keepBundleId: false });
  assert.deepEqual(withKeep({ url: "u", keepBundleId: true }, false), { url: "u", keepBundleId: true });
  assert.deepEqual(withKeep(null, false), { keepBundleId: false });
});

test("Custom Install: the switch always goes, and the ID compares with what that choice signs as", () => {
  const info = { token: "t", app: { name: "YouTube", bundleId: "com.google.ios.youtube" }, signsAs: "com.google.ios.youtube",
    appIdAs: "com.you.youtube", keepBundleId: true };
  assert.deepEqual(installParams(info, { bundleId: "com.google.ios.youtube", keepBundleId: true }), { token: "t", keepBundleId: true });
  assert.deepEqual(installParams(info, { bundleId: "com.you.youtube", keepBundleId: false }), { token: "t", keepBundleId: false });
  assert.deepEqual(installParams(info, { bundleId: "com.me.other", keepBundleId: true }), { token: "t", keepBundleId: true, bundleId: "com.me.other" });
  assert.equal(signsAsFor(info, true), "com.google.ios.youtube");
  assert.equal(signsAsFor(info, false), "com.you.youtube");
  assert.equal(signsAsFor(info, undefined), "com.google.ios.youtube");
  assert.equal(installedId(null, { token: "t", keepBundleId: false }, info), "com.you.youtube");
  assert.equal(installedId(null, { token: "t", keepBundleId: true }, info), "com.google.ios.youtube");
  // an older shell (no appIdAs, signsAs the profile's) still reads as before
  assert.equal(signsAsFor({ app: { bundleId: "a.b" }, signsAs: "com.you.b" }, undefined), "com.you.b");
});

test("My IPAs in the queue: Sign Options saved the old way stay so; otherwise the global setting decides", () => {
  const entry = { file: "A.ipa", name: "A", bundleId: "io.dev.a", version: "1" };
  // F243: null is "no Sign Options saved" (the setting decides); true is the Sign Options page's switch, sent as it is
  assert.equal(libraryJob({ ...entry, options: { keepBundleId: null } }).options, null);
  assert.deepEqual(libraryJob({ ...entry, options: { keepBundleId: true } }).options, { edits: { keepBundleId: true } });
  assert.deepEqual(libraryJob({ ...entry, options: { keepBundleId: false } }).options, { edits: { keepBundleId: false } });
  assert.equal(libraryJob(entry).id, "io.dev.a", "it installs as its own ID");
});

test("the website's parsed profile carries Push for the notes", () => {
  const xml = (ent) => new TextEncoder().encode(plistXml({ Name: "P", TeamIdentifier: ["TEAM"], Entitlements: ent }));
  assert.equal(parseProfile(xml({ "application-identifier": "TEAM.com.you.yt", "aps-environment": "production" })).push, "production");
  assert.equal(parseProfile(xml({ "application-identifier": "TEAM.com.you.*" })).push, null);
  assert.equal(profileInfo(xml({ "application-identifier": "TEAM.com.you.yt", "aps-environment": "development" })).push, "development");
});

// ---- the website's job with a fake zsign: kept, no -b and the profile's App ID in the entitlements ----------------
function fakeZsign(bundleId) {
  const files = new Map();
  const seen = { args: null, files };
  const create = async () => ({
    FS: {
      mkdir: () => {}, writeFile: (p, d) => files.set(p, d), readFile: (p) => files.get(p), unlink: (p) => files.delete(p),
      readdir: () => [".", "..", "App.app"],
    },
    ccall: (name) => (name === "ifizbox_unzip" ? 0 : JSON.stringify({ CFBundleIdentifier: bundleId, CFBundleName: "App" })),
    callMain: (args) => { seen.args = args; files.set(args[args.indexOf("-o") + 1], new Uint8Array([0x50, 0x4b, 1])); return 0; },
  });
  return { create, seen };
}
const explicit = new TextEncoder().encode(plistXml({ Name: "YT", TeamIdentifier: ["TEAM"],
  Entitlements: { "application-identifier": "TEAM.com.you.youtube", "com.apple.developer.team-identifier": "TEAM",
    "keychain-access-groups": ["TEAM.*"], "aps-environment": "production" } }));
const job = (over) => ({ ipa: new Uint8Array([0x50, 0x4b, 3, 4]), p12: new Uint8Array(1), profile: explicit, password: "", ...over });

test("website signing keeps the app's ID: no -b, entitlements with the profile's App ID, keychain group narrowed, Push", async () => {
  const { create, seen } = fakeZsign("com.google.ios.youtube");
  const r = await runSignJob(create, job({}));
  assert.equal(r.bundleId, "com.google.ios.youtube");
  assert.equal(seen.args.includes("-b"), false, "zsign takes Info.plist's ID");
  const ents = parsePlist(seen.files.get("/w/ents.plist"));
  assert.equal(ents["application-identifier"], "TEAM.com.you.youtube");
  assert.deepEqual(ents["keychain-access-groups"], ["TEAM.com.you.youtube"]);
  assert.equal(ents["aps-environment"], "production");
  assert.equal(ents["get-task-allow"], false);
});

test("website signing the old way (keepBundleId false), and iFizBox's own IPA always the old way", async () => {
  let { create, seen } = fakeZsign("com.google.ios.youtube");
  let r = await runSignJob(create, job({ keepBundleId: false }));
  assert.equal(r.bundleId, "com.you.youtube");
  assert.equal(seen.args[seen.args.indexOf("-b") + 1], "com.you.youtube");
  ({ create, seen } = fakeZsign("com.ryha.ifizbox"));
  r = await runSignJob(create, job({}));
  assert.equal(r.bundleId, "com.you.youtube", "an update must replace the iFizBox installed under the profile's ID");
});
