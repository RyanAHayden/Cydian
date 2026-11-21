// B273: one source, whatever spelling it was added under (core/sources.js sourceMatchKey / sameSource), in
// Recommended (core/sourcelist.js recommendedRows), Import's review, Add Source (core/altstore.js withAltSources) and
// the merge of duplicates already saved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceMatchKey, sameSource, findSameSource, duplicateSources, sourceKey } from "./sources.js";
import { altKey, withAltSources } from "./altstore.js";
import { recommendedRows, reviewImport } from "./sourcelist.js";
import { RECOMMENDED_SOURCES } from "./recommended.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";
import { SELF_ALT_URL } from "./essential.js";

const FLYCAST = "https://github.com/chachillie/Flycast-iOS/raw/refs/heads/main/flycast-ios.json";
const FLYCAST_SPELLINGS = [
  FLYCAST,
  "https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json", // the default app sources' spelling
  "https://raw.githubusercontent.com/chachillie/Flycast-iOS/main/flycast-ios.json",
  "https://raw.githubusercontent.com/chachillie/Flycast-iOS/refs/heads/main/flycast-ios.json",
  "http://raw.githubusercontent.com/chachillie/Flycast-iOS/refs/heads/main/flycast-ios.json",
  "http://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json",
  "https://www.github.com/chachillie/flycast-ios/raw/main/flycast-ios.json",
  "https://raw.githubusercontent.com/chachillie/Flycast-iOS/main/flycast-ios.json/",
];

test("every Flycast spelling has one match key", () => {
  const want = sourceMatchKey(FLYCAST);
  assert.equal(want, "raw.githubusercontent.com/chachillie/flycast-ios/main/flycast-ios.json");
  for (const u of FLYCAST_SPELLINGS) assert.equal(sourceMatchKey(u), want, u);
});

test("different files, branches, owners and suites stay different sources", () => {
  const k = sourceMatchKey(FLYCAST);
  assert.notEqual(sourceMatchKey("https://github.com/chachillie/Flycast-iOS/raw/dev/flycast-ios.json"), k);
  assert.notEqual(sourceMatchKey("https://github.com/chachillie/Flycast-iOS/raw/main/other.json"), k);
  assert.notEqual(sourceMatchKey("https://github.com/someone/Flycast-iOS/raw/main/flycast-ios.json"), k);
  assert.notEqual(sourceMatchKey("https://repo.example.com/a/"), sourceMatchKey("https://repo.example.com/b/"));
  assert.notEqual(sourceMatchKey("https://repo.example.com/", "stable"), sourceMatchKey("https://repo.example.com/"));
  assert.equal(sourceMatchKey("https://repo.example.com/", "./"), sourceMatchKey("http://Repo.Example.com"));
  assert.equal(sourceMatchKey("not a url"), null);
  assert.equal(sourceMatchKey("ftp://x.example/"), null);
});

test("the same app source identifier is one source; no identifier never matches", () => {
  assert.ok(sameSource({ uri: "https://a.example/x.json", identifier: "com.chachirie.source" },
    { uri: "https://b.example/y.json", identifier: "com.chachirie.source" }));
  assert.ok(!sameSource({ uri: "https://a.example/x.json", identifier: null }, { uri: "https://b.example/y.json", identifier: null }));
  assert.ok(!sameSource({ uri: "https://a.example/x.json", identifier: "" }, { uri: "https://b.example/y.json", identifier: "" }));
  const list = [{ key: "alt:1", uri: FLYCAST }];
  assert.equal(findSameSource(list, { uri: FLYCAST_SPELLINGS[2] })?.key, "alt:1");
  assert.equal(findSameSource(list, { uri: FLYCAST_SPELLINGS[2] }, { except: "alt:1" }), null);
});

const flycastRec = RECOMMENDED_SOURCES.find((r) => r.name === "Flycast");

test("Recommended shows Flycast as Added under any spelling, or the same identifier", () => {
  assert.equal(flycastRec.url, FLYCAST);
  for (const u of FLYCAST_SPELLINGS) {
    const listed = { key: altKey(u), kind: "altstore", uri: u, name: "Flycast", count: 2, updated: 1 };
    const row = recommendedRows([flycastRec], [listed], { jailbroken: false })[0];
    assert.equal(row.added, true, u);
    assert.equal(row.key, listed.key, "the row opens the listed source's page");
  }
  const moved = { key: altKey("https://mirror.example/fly.json"), kind: "altstore", uri: "https://mirror.example/fly.json",
    identifier: "com.chachirie.source", updated: 1 };
  assert.equal(recommendedRows([flycastRec], [moved], { jailbroken: false })[0].added, true);
  const other = { key: altKey("https://other.example/x.json"), kind: "altstore", uri: "https://other.example/x.json", updated: 1 };
  assert.equal(recommendedRows([flycastRec], [other], { jailbroken: false })[0].added, false);
});

test("a recommended entry without an identifier matches through its preview's", () => {
  const rec = { kind: "source", name: "X", tag: "dev", url: "https://x.example/source", why: "" };
  const listed = { key: altKey("https://y.example/s.json"), kind: "altstore", uri: "https://y.example/s.json", identifier: "x.id", updated: 1 };
  const previews = new Map([[altKey("https://x.example/source"), { identifier: "x.id" }]]);
  assert.equal(recommendedRows([rec], [listed], { jailbroken: false })[0].added, false);
  assert.equal(recommendedRows([rec], [listed], { jailbroken: false, previews })[0].added, true);
});

test("Recommended's APT repos match over http", () => {
  const havoc = RECOMMENDED_SOURCES.find((r) => r.name === "Havoc");
  const listed = { key: sourceKey({ uri: "http://havoc.app/", dist: "./" }), uri: "http://havoc.app/", dist: "./", updated: 1 };
  assert.equal(recommendedRows([havoc], [listed], { jailbroken: true })[0].added, true);
});

test("Import lists another Flycast spelling as listed", () => {
  const sources = [{ key: altKey(FLYCAST), kind: "altstore", uri: FLYCAST }];
  const [e] = reviewImport([{ kind: "altstore", uri: FLYCAST_SPELLINGS[2], input: "x" }], sources);
  assert.equal(e.status, "listed");
});

test("duplicateSources keeps one: a loaded one first, else the first listed", () => {
  const a = { key: altKey(FLYCAST), uri: FLYCAST, updated: null, error: null };
  const b = { key: altKey(FLYCAST_SPELLINGS[2]), uri: FLYCAST_SPELLINGS[2], updated: 5, error: null };
  const c = { key: altKey(FLYCAST_SPELLINGS[1]), uri: FLYCAST_SPELLINGS[1], updated: 6, error: null };
  const other = { key: altKey("https://o.example/x.json"), uri: "https://o.example/x.json" };
  assert.deepEqual(duplicateSources([a, other, b, c]).sort(), [a.key, c.key].sort());
  assert.deepEqual(duplicateSources([other]), []);
  const failed = { ...a, updated: 3, error: "404" };
  const never = { ...a, key: "alt:x", uri: FLYCAST_SPELLINGS[3] };
  assert.deepEqual(duplicateSources([failed, never]), ["alt:x"], "neither loaded: the first listed stays");
  const fork = { key: altKey("https://fork.example/x.json"), uri: "https://fork.example/x.json", identifier: "com.chachirie.source" };
  assert.deepEqual(duplicateSources([{ ...b, identifier: "com.chachirie.source" }, fork]), [],
    "a shared identifier alone is never merged away");
  // The built-in under its own URL stays even before it has loaded; the other spelling goes.
  const builtin = { key: altKey(SELF_ALT_URL), uri: SELF_ALT_URL, updated: null, error: null };
  const http = { key: altKey(SELF_ALT_URL.replace("https:", "http:")), uri: SELF_ALT_URL.replace("https:", "http:"), updated: 4, error: null };
  assert.deepEqual(duplicateSources([http, builtin]), [http.key]);
});

// ---- Add Source and the stored list ------------------------------------------------------------------------

const MIRROR = "https://mirror.example/fly.json";
const SOURCE_JSON = JSON.stringify({ name: "Flycast", identifier: "com.chachirie.source", apps: [
  { name: "Flycast", bundleIdentifier: "com.flycast", developerName: "x", version: "1.0", downloadURL: "https://x.example/f.ipa" }] });

function harness(idb = fakeIndexedDB()) {
  const fetched = [];
  const files = { [FLYCAST]: SOURCE_JSON, [FLYCAST_SPELLINGS[2]]: SOURCE_JSON, [MIRROR]: SOURCE_JSON };
  const get = (u) => {
    fetched.push(u);
    if (u in files) return files[u];
    throw Object.assign(new Error("upstream answered HTTP 404"), { code: "upstream", status: 404 });
  };
  const backend = { text: async (u) => get(u), fetch: async (u) => new Response(get(u)) };
  const calls = {
    sources: async () => [],
    addSource: async () => { throw new Error("no APT here"); },
    removeSource: async () => {},
    refreshSources: async () => [],
  };
  return { idb, fetched, b: withAltSources(calls, backend, { indexedDB: idb }) };
}

test("Add Source with another Flycast spelling saves nothing and says it is already added", async () => {
  const { b, fetched } = harness();
  const first = await b.addSource(FLYCAST);
  assert.equal(first.key, altKey(FLYCAST));
  assert.equal(first.identifier, "com.chachirie.source");
  assert.ok(!first.alreadyAdded);
  for (const u of FLYCAST_SPELLINGS) {
    fetched.length = 0;
    const again = await b.addSource(u);
    assert.equal(again.alreadyAdded, true, u);
    assert.equal(again.key, first.key);
    assert.deepEqual(fetched, [], "known before anything is fetched");
  }
  const link = await b.addSource("altstore://source?url=" + encodeURIComponent(FLYCAST_SPELLINGS[2]));
  assert.equal(link.alreadyAdded, true);
  assert.equal((await b.sources()).length, 1);
});

test("Add Source refuses a new URL whose JSON has an identifier the list has", async () => {
  const { b } = harness();
  await b.addSource(FLYCAST);
  const again = await b.addSource(MIRROR);
  assert.equal(again.alreadyAdded, true);
  assert.equal(again.key, altKey(FLYCAST));
  assert.equal((await b.sources()).length, 1);
});

test("Edit Source's own key doesn't count (replaces), and duplicates already saved merge as the list is read", async () => {
  const { b, idb } = harness();
  await b.addSource(FLYCAST);
  // Edit Source saves the new spelling before it removes the old one: for that moment both are stored, as two
  // spellings were before B273.
  const edited = await b.addSource(FLYCAST_SPELLINGS[2], { replaces: altKey(FLYCAST) });
  assert.ok(!edited.alreadyAdded);
  assert.equal(edited.key, altKey(FLYCAST_SPELLINGS[2]));
  const fresh = harness(idb).b;
  const list = await fresh.sources();
  assert.equal(list.length, 1, "one kept");
  const again = await harness(idb).b.sources();
  assert.deepEqual(again.map((s) => s.key), list.map((s) => s.key), "the other one is gone from the store");
});
