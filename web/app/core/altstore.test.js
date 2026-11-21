import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseAltSource, runsOn, appStanza, installOptions, newsToNotify, normalizeAltUrl, looksLikeAltUrl, tintOf,
  withAltSources, altKey, isAltKey, appSection, compareOS,
  refreshAltSource, coreFoundationDist, GBOX_ENCRYPTED,
} from "./altstore.js";
import { parseIpaSource } from "./sources/ipa.js";
import { sourceFilter } from "./sources.js";
import { createCatalog, ALL } from "./catalog.js";
import { newRecords, changeGroups, recordKey } from "./changes.js";
import { compat } from "./compat.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

const FIXTURE = readFileSync(new URL("./fixtures/altstore-source.json", import.meta.url), "utf8");
const URL_ = "https://example.dev/apps.json";
const KEY = altKey(URL_);

test("altstore: fixture JSON parses into catalog rows, newest version the phone runs", () => {
  const c = createCatalog();
  assert.equal(c.loadAlt(KEY, FIXTURE, "16.5"), 3); // the empty and id-less apps are dropped; Emu listed again with a build it has merges into it (F42)
  const rows = c.list(KEY);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.version, r.section, r.kind]), [
    ["dev.example.emu", "Emu", "1.5", "Apps (Games)", "ipa"], // 2.0 needs iOS 17: hidden
    ["dev.example.legacy", "Legacy", "3.1", "Apps", "ipa"],
    ["dev.example.signed", "Signed", "1.0", "Apps (Utilities)", "ipa"],
  ]);
  const emu = rows[0];
  assert.equal(emu.short, "A game emulator.");
  assert.equal(emu.author, "Example Dev");
  assert.equal(emu.icon, "https://example.dev/emu.png");
  // Rows are in All Sources and Search like any package.
  assert.equal(c.list(ALL).length, 3);
  assert.deepEqual(c.search("emulator").map((r) => r.id), ["dev.example.emu"]);
  assert.deepEqual(c.search("emu", { section: "group:Apps" }).map((r) => r.id), ["dev.example.emu"]);

  // The package page gets the whole app, with only the versions this phone runs (newest first).
  const p = c.package("dev.example.emu", KEY);
  assert.equal(p.stanza.kind, "ipa");
  assert.deepEqual(p.stanza.ipa.versions.map((v) => v.version), ["1.5", "1.0"]);
  assert.equal(p.stanza.ipa.sourceUrl, URL_);
  assert.equal(p.stanza.ipa.sourceName, "Example Apps");
  assert.equal(p.stanza.size, 41943040);

  // Other iOS versions: 17 gets 2.0; 13 runs no Emu at all (1.0 needs 14), so it is left out; unknown: newest.
  assert.equal(c.loadAlt(KEY, FIXTURE, "17.1"), 3);
  assert.equal(c.package("dev.example.emu", KEY).stanza.version, "2.0");
  assert.equal(c.loadAlt(KEY, FIXTURE, "13.0"), 2);
  assert.equal(c.package("dev.example.emu", KEY), null);
  c.loadAlt(KEY, FIXTURE, null);
  assert.equal(c.package("dev.example.emu", KEY).stanza.version, "2.0");
});

test("altstore: apps suit phones without a jailbreak; debs don't", () => {
  const c = createCatalog();
  c.loadAlt(KEY, FIXTURE, "16.5");
  const st = c.package("dev.example.emu", KEY).stanza;
  assert.equal(compat(st, { ios: "16.5", jailbreak: "none" }).status, "works");
  assert.equal(compat(st, { ios: "14.0", jailbreak: "none" }).status, "no"); // 1.5 needs 15
  assert.equal(compat({ package: "com.ex.tweak", architecture: "iphoneos-arm64" }, { ios: "16.5", jailbreak: "none" }).reason, "jailbreak");
  c.setDevice({ ios: "16.5", jailbreak: "none" });
  assert.equal(c.list(KEY)[0].compat, "works");
});

test("altstore: Changes lists a bumped version, and never one the phone can't run", () => {
  const c = createCatalog();
  const json = JSON.parse(FIXTURE);
  const day1 = Date.UTC(2026, 10, 16, 9);
  const day2 = day1 + 86400000;
  const day3 = day2 + 86400000;
  const records = [];
  const refresh = (now) => {
    const known = new Set(records.map((r) => r.k));
    records.push(...newRecords(known, c.versions(), now));
  };
  // Day 1: Emu's newest is 2.0 (iOS 17 only), so iOS 16.5 files 1.5.
  c.loadAlt(KEY, json, "16.5");
  refresh(day1);
  assert.ok(records.some((r) => r.k === recordKey(KEY, "dev.example.emu", "1.5")));
  assert.ok(!records.some((r) => r.version === "2.0"));
  // Day 2: a new 2.1 that also needs iOS 17: nothing new for this phone.
  json.apps[0].versions.unshift({ version: "2.1", date: "2026-11-16", downloadURL: "https://example.dev/emu-2.1.ipa", minOSVersion: "17.0" });
  c.loadAlt(KEY, json, "16.5");
  refresh(day2);
  assert.equal(records.filter((r) => r.first === day2).length, 0);
  // Day 3: Legacy is bumped to 3.2: it shows under day 3 as updated.
  json.apps[1].version = "3.2";
  c.loadAlt(KEY, json, "16.5");
  refresh(day3);
  const groups = changeGroups(records, c.list(ALL));
  assert.equal(groups.length, 1); // day 1 (the first load) is dropped
  assert.equal(groups[0].seen, day3);
  assert.deepEqual(groups[0].rows.map((r) => [r.id, r.version, r.change]), [["dev.example.legacy", "3.2", "updated"]]);
});

test("altstore: source fields, news, screenshots and permissions", () => {
  const s = parseAltSource(FIXTURE);
  assert.equal(s.name, "Example Apps");
  assert.equal(s.tintColor, "#8a28f7");
  assert.equal(s.headerURL, "https://example.dev/header.png");
  assert.deepEqual(s.featuredApps, ["dev.example.emu"]); // ids with no app are dropped
  assert.deepEqual(s.news.map((n) => [n.identifier, n.notify]), [["emu-2", true], ["welcome", false]]);
  const emu = s.apps[0];
  assert.deepEqual(emu.screenshots.map((x) => x.url), ["https://example.dev/s1.png", "https://example.dev/s2.png", "https://example.dev/pad.png"]);
  assert.equal(emu.screenshots[1].width, 1179);
  assert.deepEqual(emu.permissions.privacy.map((p) => [p.name, p.description]), [["Camera", "Scan QR codes."], ["Local Network", "Play with friends."]]);
  assert.deepEqual(emu.permissions.entitlements.map((e) => e.name), ["com.apple.developer.kernel.increased-memory-limit"]);
  assert.deepEqual(emu.versions.map((v) => [v.version, v.localizedDescription, v.size]), [
    ["2.0", "Needs iOS 17.", 52428800], ["1.5", "Faster.", 41943040], ["1.0", "First release.", 31457280]]);
  assert.equal(emu.versions[1].date, new Date(2026, 9, 1).getTime()); // a bare date is local
  assert.equal(emu.versions[0].date, Date.parse("2026-11-10T10:00:00Z"));
  const legacy = s.apps[1];
  assert.deepEqual(legacy.versions.map((v) => [v.version, v.localizedDescription, v.size, v.date]),
    [["3.1", "Bug fixes.", 1048576, new Date(2025, 4, 5).getTime()]]);
  assert.deepEqual(legacy.permissions.privacy.map((p) => p.name), ["Photos"]);
  assert.deepEqual(legacy.screenshots.map((x) => x.url), ["https://example.dev/l1.png"]);
  // The catalog keeps the page data apart from the apps.
  const c = createCatalog();
  c.loadAlt(KEY, FIXTURE, "16.5");
  const meta = c.altSource(KEY);
  assert.equal(meta.name, "Example Apps");
  assert.deepEqual(meta.featured.map((r) => r.version), ["1.5"]);
  assert.equal(meta.apps, undefined);
  c.remove(KEY);
  assert.equal(c.altSource(KEY), null);
});

test("altstore: bad JSON and non-sources throw; bad optional fields are dropped", () => {
  assert.throws(() => parseAltSource("<html>"), /not valid JSON/);
  assert.throws(() => parseAltSource("[]"), /not an AltStore source/);
  assert.throws(() => parseAltSource('{"name":"x"}'), /not an AltStore source/);
  const s = parseAltSource({ apps: [{ bundleIdentifier: "a", version: 2, downloadURL: "https://x/a.ipa", iconURL: "javascript:alert(1)", tintColor: "red;background:url(x)", screenshots: "nope" }], news: "no" });
  assert.equal(s.apps[0].iconURL, null);
  assert.equal(s.apps[0].tintColor, null);
  assert.deepEqual(s.apps[0].screenshots, []);
  assert.equal(s.apps[0].versions[0].version, "2");
  assert.deepEqual(s.news, []);
  assert.equal(tintOf("#ABC"), "#aabbcc");
});

test("altstore: min/maxOSVersion", () => {
  assert.equal(compareOS("16.4.1", "16.4"), 1);
  assert.equal(compareOS("16", "16.0.0"), 0);
  assert.equal(runsOn({ minOSVersion: "15.0" }, "14.8"), false);
  assert.equal(runsOn({ minOSVersion: "15.0" }, "15"), true);
  assert.equal(runsOn({ maxOSVersion: "16" }, "16.7.2"), true); // any 16.x
  assert.equal(runsOn({ maxOSVersion: "16.1" }, "16.2"), false);
  assert.equal(runsOn({ minOSVersion: "99" }, null), true);
  assert.equal(appStanza({ bundleIdentifier: "a", name: "A", localizedDescription: "", subtitle: "", versions: [{ version: "1", minOSVersion: "18" }] }, null, "17.0"), null);
  assert.equal(appSection("photo-video"), "Apps (Photo & Video)");
  assert.equal(appSection("weird"), "Apps (Weird)");
});

test("altstore: itms-services only where a signed link exists, else sideloader links", () => {
  const s = parseAltSource(FIXTURE);
  const signed = installOptions(s.apps[2].versions[0], URL_);
  assert.equal(signed.itms, "itms-services://?action=download-manifest&url=https%3A%2F%2Fexample.dev%2Fsigned.plist");
  const plain = installOptions(s.apps[0].versions[0], URL_);
  assert.equal(plain.itms, null);
  assert.equal(plain.download, "https://example.dev/emu-2.0.ipa");
  assert.deepEqual(plain.open.map((o) => o.url), [
    "altstore://source?url=https%3A%2F%2Fexample.dev%2Fapps.json",
    "sidestore://source?url=https%3A%2F%2Fexample.dev%2Fapps.json",
    "feather://source/https://example.dev/apps.json",
  ]);
  assert.equal(installOptions({ downloadURL: "itms-services://?action=download-manifest&url=x" }, URL_).itms, "itms-services://?action=download-manifest&url=x");
});

test("altstore: news to notify", () => {
  const s = parseAltSource(FIXTURE);
  assert.deepEqual(newsToNotify(s).map((n) => n.identifier), ["emu-2"]);
  assert.deepEqual(newsToNotify(s, ["emu-2"]), []);
});

test("altstore: source URLs", () => {
  assert.equal(normalizeAltUrl("example.dev/apps.json"), "https://example.dev/apps.json");
  assert.equal(normalizeAltUrl("altstore://source?url=https%3A%2F%2Fexample.dev%2Fa.json"), "https://example.dev/a.json");
  assert.equal(normalizeAltUrl("ftp://x"), null);
  assert.equal(looksLikeAltUrl("https://x/apps.json"), true);
  assert.equal(looksLikeAltUrl("sidestore://source?url=x"), true);
  assert.equal(looksLikeAltUrl("https://repo.chariz.com/"), false);
  assert.equal(isAltKey(KEY), true);
  assert.equal(isAltKey("deb:https://x/:./"), false);
});

test("altstore: sources sit beside the APT list: add, list, refresh, remove", async () => {
  let json = FIXTURE;
  const get = (u) => { if (u === URL_) return json; throw Object.assign(new Error("404"), { code: "not_found" }); };
  const backend = {
    text: async (u) => get(u),
    fetch: async (u) => new Response(get(u)),
    packages: async () => { throw Object.assign(new Error("no Packages"), { code: "not_found" }); },
  };
  const apt = [{ key: "deb:https://repo.example/:./", uri: "https://repo.example/" }];
  const calls = {
    sources: async () => apt,
    addSource: async () => { throw Object.assign(new Error("not found"), { kind: "not_repository" }); },
    removeSource: async () => "apt",
    refreshSources: async (onEach) => { onEach(apt[0]); return apt; },
  };
  const s = withAltSources(calls, backend, { indexedDB: fakeIndexedDB() });
  const added = await s.addSource("altstore://source?url=" + encodeURIComponent(URL_));
  assert.equal(added.key, KEY);
  assert.equal(added.kind, "altstore");
  assert.equal(added.name, "Example Apps");
  assert.equal(added.count, 6 - 3);
  assert.equal(added.tintColor, "#8a28f7");
  assert.deepEqual((await s.sources()).map((x) => x.key), [apt[0].key, KEY]);
  // F16a: nothing at the URL, as JSON or as an APT repo: detectSource's message says what was looked for.
  await assert.rejects(s.addSource("https://nothing.example/"), (e) => e.kind === "not_source" && /APT repository/.test(e.message));
  // Refresh: both lists, each record passed to onEach.
  json = JSON.stringify({ ...JSON.parse(FIXTURE), name: "Renamed" });
  const seen = [];
  await s.refreshSources((x) => seen.push(x.key));
  assert.deepEqual(seen.sort(), [apt[0].key, KEY].sort());
  assert.equal((await s.sources())[1].name, "Renamed");
  // F41: a filter that keeps no APT source never asks the wrapped calls; AltStore ones still refresh.
  let aptRefreshes = 0;
  const wrapped = calls.refreshSources;
  calls.refreshSources = async (...a) => { aptRefreshes++; return wrapped(...a); };
  const onlyAlt = [];
  await s.refreshSources((x) => onlyAlt.push(x.key), { filter: sourceFilter("none") });
  assert.equal(aptRefreshes, 0);
  assert.deepEqual(onlyAlt, [KEY]);
  await s.refreshSources(() => {}, { filter: sourceFilter("iphoneos-arm64") });
  assert.equal(aptRefreshes, 1, "a jailbroken type refreshes APT too");
  calls.refreshSources = wrapped;
  // A broken source keeps its record with an error.
  json = "oops";
  await s.refreshSources();
  assert.match((await s.sources())[1].error, /JSON/);
  assert.equal((await s.sources())[1].name, "Renamed");
  assert.equal(await s.removeSource(apt[0].key), "apt");
  await s.removeSource(KEY);
  assert.deepEqual((await s.sources()).map((x) => x.key), [apt[0].key]);
});

test("F42: repeated entries of one app merge into its version history; variants under one bundle id stay apart", () => {
  const ipa = (n) => `https://example.dev/${n}.ipa`;
  const json = { name: "Repeats", featuredApps: ["dev.ex.app"], apps: [
    // AppTesters-style: one entry per version, same name, listed out of date order once.
    { name: "App", bundleIdentifier: "dev.ex.app", version: "2.0", versionDate: "2026-11-02", downloadURL: ipa("a2"), iconURL: "https://example.dev/a.png" },
    { name: "app", bundleIdentifier: "dev.ex.app", version: "1.0", versionDate: "2026-10-01", downloadURL: ipa("a1"), iconURL: "https://example.dev/old.png" },
    { name: "App", bundleIdentifier: "dev.ex.app", version: "3.0", versionDate: "2026-11-10", downloadURL: ipa("a3") },
    { name: "App", bundleIdentifier: "dev.ex.app", version: "2.0", versionDate: "2026-11-02", downloadURL: ipa("a2") }, // listed twice
    // RyukSign-style: variants with other names.
    { name: "App (iOS 15)", bundleIdentifier: "dev.ex.app", version: "3.0", minOSVersion: "15.0", downloadURL: ipa("v15") },
    { name: "App (iOS 15)", bundleIdentifier: "dev.ex.app", version: "2.0", minOSVersion: "15.0", downloadURL: ipa("v15-2") },
    { name: "App iOS 15", bundleIdentifier: "dev.ex.app", version: "3.0", downloadURL: ipa("v15b") }, // same slug: ~2
    // Undated versions keep the source's order.
    { name: "Plain", bundleIdentifier: "dev.ex.plain", version: "1", downloadURL: ipa("p1") },
    { name: "Plain", bundleIdentifier: "dev.ex.plain", version: "2", downloadURL: ipa("p2") },
  ] };
  const s = parseAltSource(json);
  assert.deepEqual(s.apps.map((a) => [a.id, a.bundleIdentifier, a.name]), [
    ["dev.ex.app", "dev.ex.app", "App"],
    ["dev.ex.app~app-ios-15", "dev.ex.app", "App (iOS 15)"],
    ["dev.ex.app~app-ios-15~2", "dev.ex.app", "App iOS 15"],
    ["dev.ex.plain", "dev.ex.plain", "Plain"],
  ]);
  assert.deepEqual(s.apps[0].versions.map((v) => v.version), ["3.0", "2.0", "1.0"]);
  assert.equal(s.apps[0].iconURL, "https://example.dev/a.png"); // the first entry's app fields win
  assert.deepEqual(s.apps[1].versions.map((v) => v.version), ["3.0", "2.0"]);
  assert.deepEqual(s.apps[3].versions.map((v) => v.version), ["1", "2"]);
  assert.deepEqual(s.featuredApps, ["dev.ex.app"]);
  assert.equal(s.apps[0].merged, undefined);

  // In the catalog each variant is its own row, keyed by its id; the merged app has the whole history.
  const c = createCatalog();
  assert.equal(c.loadAlt(KEY, json, "14.0"), 3); // the iOS 15 variant runs nothing on 14
  assert.deepEqual(c.list(KEY).map((r) => [r.id, r.version]),
    [["dev.ex.app", "3.0"], ["dev.ex.app~app-ios-15~2", "3.0"], ["dev.ex.plain", "1"]]);
  c.loadAlt(KEY, json, "16.0");
  const v = c.package("dev.ex.app~app-ios-15", KEY);
  assert.equal(v.stanza.ipa.bundleIdentifier, "dev.ex.app");
  assert.equal(v.stanza.ipa.versions[0].downloadURL, ipa("v15"));
  assert.deepEqual(c.history("dev.ex.app", KEY).versions.map((x) => x.version), ["3.0", "2.0", "1.0"]);
  assert.deepEqual(c.altSource(KEY).featured.map((r) => r.name), ["App"]);
});

// ---- F16a: every IPA format through the same list and catalog --------------------------------------------------

const SRC = (f) => readFileSync(new URL(`./fixtures/sources/${f}`, import.meta.url), "utf8");

// URL -> text; a missing URL fails as the proxy does ("upstream" 404), Packages as "not_found".
function formatBackend(files) {
  const get = (u) => {
    if (!(u in files)) throw Object.assign(new Error("upstream answered HTTP 404"), { code: "upstream", status: 404 });
    return files[u];
  };
  return {
    files,
    text: async (u) => get(u),
    fetch: async (u) => new Response(get(u)),
    packages: async () => { throw Object.assign(new Error("no Packages"), { code: "not_found" }); },
  };
}

const aptCalls = (added = []) => ({
  sources: async () => [],
  addSource: async (input) => { added.push(input); return { key: "deb:apt", input }; },
  removeSource: async () => {},
  refreshSources: async () => [],
});

test("F16a: a Scarlet repo is added, refreshed and loaded by its format, with Scarlet's extras", async () => {
  const url = "https://x.dev/scarlet.json";
  const backend = formatBackend({ [url]: SRC("scarlet-locus.json") });
  const s = withAltSources(aptCalls(), backend, { indexedDB: fakeIndexedDB() });
  const rec = await s.addSource(url);
  assert.equal(rec.key, altKey(url));
  assert.equal(rec.kind, "altstore");
  assert.equal(rec.format, "scarlet");
  const want = parseIpaSource("scarlet", JSON.parse(SRC("scarlet-locus.json")));
  assert.ok(want.apps.length > 0);
  assert.equal(rec.count, want.apps.length);
  assert.equal(rec.name, want.name);
  // A scarlet:// link names the same source.
  assert.equal((await s.addSource("scarlet://repo=" + url)).key, rec.key);
  assert.equal((await s.sources()).length, 1);

  // Refresh reads it as Scarlet again (parseAltSource alone would find no apps list and fail).
  const listed = (await s.sources())[0];
  const fields = await refreshAltSource(backend, listed);
  assert.equal(fields.error, null);
  assert.equal(fields.format, "scarlet");
  assert.equal(fields.count, want.apps.length);
  await s.refreshSources();
  assert.equal((await s.sources())[0].error, null);

  // The catalog reads it by the record's format: the same apps, and each app's Scarlet extras on its stanza.
  const c = createCatalog();
  assert.equal(c.loadAlt(rec.key, SRC("scarlet-locus.json"), null, rec.format), want.apps.length);
  const first = want.apps[0];
  const p = c.package(first.id, rec.key);
  assert.equal(p.stanza.kind, "ipa");
  assert.equal(p.stanza.name, first.name);
  assert.deepEqual(p.stanza.ipa.extra, first.extra);
  assert.ok("group" in p.stanza.ipa.extra, "Scarlet's group is kept");
  assert.equal(c.altSource(rec.key).name, want.name);
  // Without the format the old AltStore reader refuses it, which is why the record keeps `format`.
  assert.throws(() => c.loadAlt(rec.key, SRC("scarlet-locus.json"), null), /AltStore/);
});

test("F16a: a GBox source is added and loaded as GBox; an encrypted one is kept as unsupported", async () => {
  const url = "https://g.dev/apps.json";
  const backend = formatBackend({ [url]: SRC("gbox-qoli.json") });
  const s = withAltSources(aptCalls(), backend, { indexedDB: fakeIndexedDB() });
  const rec = await s.addSource(url);
  assert.equal(rec.format, "gbox");
  assert.equal(rec.unsupported, undefined);
  const want = parseIpaSource("gbox", JSON.parse(SRC("gbox-qoli.json")));
  assert.equal(rec.count, want.apps.length);
  const c = createCatalog();
  assert.equal(c.loadAlt(rec.key, SRC("gbox-qoli.json"), null, "gbox"), want.apps.length);
  const p = c.package(want.apps[0].id, rec.key);
  assert.equal(p.stanza.ipa.bundleIdentifier, want.apps[0].bundleIdentifier);
  assert.deepEqual(p.stanza.ipa.extra, want.apps[0].extra);

  // Encrypted: added with its reason and no apps, refreshed without an error, and readable again once it isn't.
  const enc = "https://g.dev/locked.json";
  backend.files[enc] = SRC("gbox-encrypted.json");
  const locked = await s.addSource(enc);
  assert.equal(locked.format, "gbox");
  assert.equal(locked.unsupported, GBOX_ENCRYPTED);
  assert.equal(locked.count, null);
  await s.refreshSources();
  let now = (await s.sources()).find((x) => x.key === locked.key);
  assert.equal(now.unsupported, GBOX_ENCRYPTED);
  assert.equal(now.error, null);
  backend.files[enc] = SRC("gbox-qoli.json");
  await s.refreshSources();
  now = (await s.sources()).find((x) => x.key === locked.key);
  assert.equal(now.unsupported, null);
  assert.equal(now.count, want.apps.length);
  // B273: re-adding it saves nothing (Already Added) and hands back the listed record, readable since the refresh.
  const again = await s.addSource(enc);
  assert.equal(again.alreadyAdded, true);
  assert.equal(again.unsupported ?? null, null);
});

test("F16a: an APT repo found by detection goes to the wrapped calls; dist repos as { uri, dist, components }", async () => {
  const added = [];
  const dir = "https://apt.example/";
  const backend = formatBackend({
    [dir]: "<html>a landing page</html>",
    [dir + "dists/ios/793.00/Release"]: SRC("apt-dist-Release"),
    [dir + "dists/ios/793.00/main/binary-iphoneos-arm/Packages"]: SRC("apt-dist-Packages"),
  });
  backend.packages = async (d) => {
    if (d === dir + "dists/ios/793.00/main/binary-iphoneos-arm/") return { text: SRC("apt-dist-Packages"), source: d, cached: false };
    throw Object.assign(new Error("no Packages"), { code: "not_found" });
  };
  // The phone's CoreFoundation number gives Telesphoreo's suite, ios/793.00 on the 4S.
  assert.equal(coreFoundationDist(793), "ios/793.00");
  assert.equal(coreFoundationDist(1854.1), "ios/1854.10");
  assert.equal(coreFoundationDist(null), null);
  const s = withAltSources(aptCalls(added), backend, { indexedDB: fakeIndexedDB(), arch: () => "iphoneos-arm", coreFoundation: () => 793 });
  const r = await s.addSource(dir);
  assert.equal(r.key, "deb:apt");
  assert.equal(added.length, 1);
  assert.equal(added[0].uri, dir);
  assert.equal(added[0].dist, "ios/793.00");
  assert.ok(added[0].components.length > 0);
  // Without that suite among the dists, the same repo is not found.
  const t = withAltSources(aptCalls(), backend, { indexedDB: fakeIndexedDB(), arch: () => "iphoneos-arm" });
  await assert.rejects(t.addSource(dir), (e) => e.kind === "not_source");
  // An Import line's dist repo skips detection.
  await s.addSource({ uri: dir, dist: "stable", components: ["main"] });
  assert.deepEqual(added[1], { uri: dir, dist: "stable", components: ["main"] });
  assert.equal((await s.sources()).length, 0, "nothing went in the AltStore list");
});

test("permissions listed twice (2.0 and 1.x, or a repeated key) show once, keeping a description", async () => {
  const { parseAltSource } = await import("./altstore.js");
  const src = { name: "S", apps: [{ name: "A", bundleIdentifier: "a", versions: [{ version: "1", downloadURL: "https://x/a.ipa" }],
    appPermissions: { privacy: { NSCameraUsageDescription: "" }, entitlements: ["com.apple.developer.healthkit", "com.apple.developer.healthkit", "application-identifier", "get-task-allow"] },
    permissions: [{ type: "camera", usageDescription: "Scans codes." }, { type: "photos" }] }] };
  src.apps[0].appPermissions.privacy.NSBluetoothAlwaysUsageDescription = "To connect";
  src.apps[0].appPermissions.privacy.NSBluetoothPeripheralUsageDescription = "To connect"; // Discord's pair: one Bluetooth
  const p = parseAltSource(src).apps[0].permissions;
  assert.deepEqual(p.privacy.map((x) => [x.name, x.description]), [["Camera", "Scans codes."], ["Bluetooth", "To connect"], ["Photos", ""]]);
  assert.equal(p.entitlements.length, 1);
});
