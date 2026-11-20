// F144: the sideload IPA (and the website while Settings > Device says Not Jailbroken) keeps no APT sources: Add
// refuses one with one short alert, the list and Refresh leave stored ones out (the sideload build deletes them), and
// no hint says tweak repos are hidden or show once Settings > Device says jailbroken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { withAltSources, altKey, JAILBREAK_SOURCE_TITLE, JAILBREAK_SOURCE_MESSAGE } from "./altstore.js";
import { recommendedRows } from "./sourcelist.js";
import { RECOMMENDED_SOURCES } from "./recommended.js";
import { siteJailbroken } from "../backend.js";
import { NAME } from "../brand.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

const ALT = "https://example.dev/apps.json";
const ALT_JSON = JSON.stringify({ name: "Example Apps", identifier: "dev.example", apps: [
  { name: "Emu", bundleIdentifier: "dev.example.emu", developerName: "Ex", version: "1.0", downloadURL: "https://example.dev/emu.ipa" }] });
const REPO = "https://repo.example/";
const RELEASE = "Origin: Example\nLabel: Example\nSuite: stable\nVersion: 1.0\nCodename: ios\nArchitectures: iphoneos-arm64\nComponents: main\nDescription: x\n";
const PACKAGES = "Package: com.example.tweak\nVersion: 1.0\nArchitecture: iphoneos-arm64\nName: Tweak\n\n";

const backend = () => {
  const files = { [ALT]: ALT_JSON, [REPO + "Release"]: RELEASE };
  const get = (u) => {
    if (u in files) return files[u];
    throw Object.assign(new Error("upstream answered HTTP 404"), { code: "upstream", status: 404 });
  };
  return {
    text: async (u) => get(u),
    fetch: async (u) => new Response(get(u)),
    packages: async (dir) => {
      if (dir === REPO) return { text: PACKAGES, source: dir + "Packages", cached: false };
      throw Object.assign(new Error("no Packages"), { code: "not_found" });
    },
  };
};

// The wrapped (APT) calls, recording what reaches them.
function aptCalls(stored = []) {
  const log = { added: [], removed: [], forgot: [], refreshed: 0 };
  const calls = {
    log,
    sources: async () => stored.filter((s) => !log.forgot.includes(s.key) && !log.removed.includes(s.key)),
    addSource: async (input) => { log.added.push(input); return { key: `deb:${input.uri ?? input}:./`, uri: input.uri ?? input }; },
    removeSource: async (key) => { log.removed.push(key); },
    forget: async (key) => { log.forgot.push(key); },
    refreshSources: async () => { log.refreshed++; return []; },
  };
  return calls;
}

const OLD = [{ key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/", name: "Chariz" }];
const refused = (e) => e.title === JAILBREAK_SOURCE_TITLE && e.message === JAILBREAK_SOURCE_MESSAGE && e.code === "jailbreak_source";

test("F144: the refusal is one short alert that says jailbreak source, with no hidden or Settings > Device wording", () => {
  assert.equal(JAILBREAK_SOURCE_TITLE, "Jailbreak Source");
  assert.ok(JAILBREAK_SOURCE_MESSAGE.length < 100);
  assert.ok(/jailbr/i.test(JAILBREAK_SOURCE_MESSAGE));
  assert.ok(!/hidden|hide|Settings|Device|show here|once/i.test(JAILBREAK_SOURCE_MESSAGE));
  // The share extension refuses an APT manager's link with the same words (native/share/Share.swift).
  const swift = readFileSync(new URL("../../../native/share/Share.swift", import.meta.url), "utf8");
  assert.ok(swift.includes(`title: "${JAILBREAK_SOURCE_TITLE}"`), "Share.swift's title");
  // F170: Swift spells the name as Brand.name (native/sign/Brand.swift), the JS as NAME (brand.js).
  assert.ok(swift.includes(`message: "${JAILBREAK_SOURCE_MESSAGE.replaceAll(NAME, "\\(Brand.name)")}"`), "Share.swift's message");
});

test("F144 sideload: Add refuses an APT repo (a URL, a dist repo, a cydia:// link) and still adds an app source", async () => {
  const calls = aptCalls();
  const s = withAltSources(calls, backend(), { indexedDB: fakeIndexedDB(), aptAllowed: false, dropApt: true });
  await assert.rejects(s.addSource(REPO), refused);
  await assert.rejects(s.addSource("cydia://url/" + REPO), refused);
  await assert.rejects(s.addSource({ uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] }), refused);
  assert.deepEqual(calls.log.added, [], "nothing reached the APT calls");
  const rec = await s.addSource(ALT);
  assert.equal(rec.key, altKey(ALT));
  assert.deepEqual((await s.sources()).map((x) => x.key), [altKey(ALT)]);
});

test("F144 sideload: stored APT sources are left out of the list, deleted from the store, and never refreshed", async () => {
  const calls = aptCalls(OLD);
  const s = withAltSources(calls, backend(), { indexedDB: fakeIndexedDB(), aptAllowed: false, dropApt: true });
  await s.addSource(ALT);
  assert.deepEqual((await s.sources()).map((x) => x.key), [altKey(ALT)], "no APT source listed (or counted)");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.log.forgot, [OLD[0].key], "the old record is deleted from the device store, store only");
  assert.deepEqual(calls.log.removed, []);
  const seen = [];
  await s.refreshSources((x) => seen.push(x.key));
  assert.equal(calls.log.refreshed, 0, "APT is never refreshed");
  assert.deepEqual(seen, [altKey(ALT)]);
});

test("F144 website: Not Jailbroken refuses and hides APT sources but keeps them stored; Jailbroken works as before", async () => {
  let jailbroken = false;
  const calls = aptCalls(OLD);
  const s = withAltSources(calls, backend(), { indexedDB: fakeIndexedDB(), aptAllowed: () => jailbroken });
  await assert.rejects(s.addSource(REPO), refused);
  assert.deepEqual((await s.sources()).map((x) => x.key), []);
  await s.refreshSources();
  assert.equal(calls.log.refreshed, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.log.forgot, [], "kept for when Device says jailbroken");
  jailbroken = true;
  assert.deepEqual((await s.sources()).map((x) => x.key), [OLD[0].key]);
  await s.addSource(REPO);
  assert.deepEqual(calls.log.added, [REPO]);
  await s.refreshSources();
  assert.equal(calls.log.refreshed, 1);
});

test("F144: the jailbreak build (no aptAllowed given) keeps APT sources", async () => {
  const calls = aptCalls(OLD);
  const s = withAltSources(calls, backend(), { indexedDB: fakeIndexedDB() });
  assert.deepEqual((await s.sources()).map((x) => x.key), [OLD[0].key]);
  await s.addSource({ uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] });
  assert.equal(calls.log.added.length, 1);
});

test("F144: siteJailbroken reads Settings > Device (unset: Not Jailbroken)", () => {
  const store = (v) => ({ getItem: (k) => (k === "ifizbox.device" ? v : null) });
  assert.equal(siteJailbroken(store(null)), false);
  assert.equal(siteJailbroken(store("none")), false);
  assert.equal(siteJailbroken(store("iphoneos-arm64")), true);
  assert.equal(siteJailbroken({ getItem: () => { throw new Error("blocked"); } }), false);
});

test("F144: Recommended offers no tweak repos while Not Jailbroken", () => {
  const rows = recommendedRows(RECOMMENDED_SOURCES, [], { jailbroken: false });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => !r.rec.jailbreak && !r.key.startsWith("deb:")));
});

// Every hint that said APT sources / tweak repos are hidden, or show once Settings > Device says jailbroken.
const HINTS = [
  /Tweak repos show/i,
  /show here once Settings/i,
  /says this iPhone is jailbroken/i,
  /APT sources? (is|are) hidden/i,
  /hidden \(Not Jailbroken\)/i,
  /hidden: they list tweaks/i,
  /run on jailbroken iPhones\. Jailbroken\? Settings > Device/i,
];

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "vendor" || name === "node_modules" || name === "build") continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(js|mjs|html|swift)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p);
  }
  return out;
}

// Strings only: a comment may still say what happens (core/sources.js explains sourcesFor).
const strings = (text) => text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")
  .match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];

test("F144: no hint text about hidden tweak repos or Settings > Device remains (grep)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const found = [];
  for (const dir of ["web/app", "native/Sources", "native/share"]) {
    for (const f of files(join(root, dir))) {
      for (const s of strings(readFileSync(f, "utf8"))) {
        for (const h of HINTS) if (h.test(s)) found.push(`${relative(root, f)}: ${s.slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(found, []);
});
