// F72: iFizBox's built-in source (always there, first, not removable, not exported), the minimum version, iFizBox's
// own Changes row and its sideload install path. F183: the Essential Upgrade alert is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  builtinSources, withBuiltins, withBuiltinRecords, builtinFirst, exportable, isBuiltin, BuiltinError,
  minimumOf, selfFromAltSource, selfUpgradeRow, withSelfUpgrade, selfInfoWith, lookForSelfUpdate, installSelf, loadInfo, saveInfo,
  SELF_ID, SELF_APT_URI, SELF_ALT_URL, SELF_SITE,
} from "./essential.js";
import { altKey } from "./altstore.js";
import { sourceKey, refreshSource } from "./sources.js";
import { exportText } from "./sourcelist.js";

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// ---- the built-in source -------------------------------------------------------------------------------------

test("builtinSources: the APT repo in the jailbreak app, the AltStore source in the sideload app and on the site", () => {
  const [jb] = builtinSources("jailbreak");
  assert.equal(jb.uri, SELF_APT_URI);
  assert.equal(jb.key, sourceKey({ uri: SELF_APT_URI, dist: "./" }));
  assert.equal(jb.builtin, true);
  for (const mode of ["sideload", "site"]) {
    const [alt] = builtinSources(mode);
    assert.equal(alt.key, altKey(SELF_ALT_URL));
    assert.equal(alt.kind, "altstore");
    assert.equal(alt.builtin, true);
  }
  assert.equal(builtinSources("jailbreak").length, 1);
});

// A store of source calls in memory, enough for withBuiltins.
function fakeCalls(initial = []) {
  const list = new Map(initial.map((s) => [s.key, s]));
  const log = [];
  return {
    log, list,
    sources: async () => [...list.values()],
    async addSource(input) {
      log.push(["add", input]);
      const s = input === SELF_ALT_URL ? { key: altKey(input), uri: input, kind: "altstore", name: "iFizBox", updated: 1 }
        : { key: sourceKey({ uri: input, dist: "./" }), uri: input, dist: "./", updated: 1 };
      list.set(s.key, s);
      return s;
    },
    async removeSource(key) { log.push(["remove", key]); list.delete(key); },
    async refreshSources(onEach, opts) {
      log.push(["refresh", opts]);
      const out = [...list.values()].filter(opts?.filter ?? (() => true)).map((s) => ({ ...s, count: 3 }));
      out.forEach((s) => onEach(s));
      return out;
    },
  };
}

test("withBuiltins: always listed, first, marked builtin, even before it was ever added", async () => {
  const other = { key: "alt:https://a.example/apps.json", uri: "https://a.example/apps.json", name: "A" };
  const b = withBuiltins(fakeCalls([other]), builtinSources("sideload"));
  const list = await b.sources();
  assert.equal(list.length, 2);
  assert.equal(list[0].key, altKey(SELF_ALT_URL));
  assert.equal(list[0].builtin, true);
  assert.equal(list[0].name, "iFizBox");
  assert.equal(isBuiltin(list[1]), false);
});

test("withBuiltins: a stored built-in keeps its fields and moves first", async () => {
  const stored = { key: altKey(SELF_ALT_URL), uri: SELF_ALT_URL, name: "iFizBox", count: 1, updated: 5 };
  const z = { key: "alt:https://0.example/a.json", uri: "https://0.example/a.json", name: "0" };
  const list = await withBuiltins(fakeCalls([z, stored]), builtinSources("site")).sources();
  assert.deepEqual(list.map((s) => s.key), [stored.key, z.key]);
  assert.equal(list[0].count, 1);
});

test("withBuiltins: removeSource refuses the built-in and passes anything else on", async () => {
  const other = { key: "deb:https://repo.example/:./", uri: "https://repo.example/" };
  const calls = fakeCalls([other]);
  const b = withBuiltins(calls, builtinSources("jailbreak"));
  await assert.rejects(b.removeSource(builtinSources("jailbreak")[0].key), (e) => e instanceof BuiltinError && e.code === "builtin" && /can't be removed/.test(e.message));
  assert.deepEqual(calls.log, []);
  await b.removeSource(other.key);
  assert.deepEqual(calls.log, [["remove", other.key]]);
});

test("withBuiltins: refresh adds a missing built-in first (apt's sources in the app), and marks it in what it saw", async () => {
  const calls = fakeCalls([]);
  const b = withBuiltins(calls, builtinSources("jailbreak"));
  const seen = [];
  const out = await b.refreshSources((s) => seen.push(s));
  assert.deepEqual(calls.log[0], ["add", SELF_APT_URI]);
  assert.equal(calls.log[1][0], "refresh");
  assert.equal(out[0].builtin, true);
  assert.equal(seen[0].builtin, true);
  // Present: not added again.
  calls.log.length = 0;
  await b.refreshSources();
  assert.deepEqual(calls.log.map((l) => l[0]), ["refresh"]);
});

test("withBuiltins: a refresh whose filter leaves the built-in out doesn't add it; a failed add doesn't stop the refresh", async () => {
  const calls = fakeCalls([]);
  const b = withBuiltins(calls, builtinSources("jailbreak"));
  await b.refreshSources(undefined, { filter: (s) => String(s.key).startsWith("alt:") });
  assert.deepEqual(calls.log.map((l) => l[0]), ["refresh"]);
  calls.addSource = async () => { throw new Error("offline"); };
  calls.log.length = 0;
  await b.refreshSources();
  assert.deepEqual(calls.log.map((l) => l[0]), ["refresh"]);
});

test("builtinFirst puts the built-in back on top after a reorder; exportable leaves it out of Export", () => {
  const list = withBuiltinRecords([{ key: "alt:x", uri: "https://x.example/a.json" }], builtinSources("sideload"));
  const reordered = [list[1], list[0]];
  assert.deepEqual(builtinFirst(reordered).map((s) => s.key), [list[0].key, "alt:x"]);
  assert.deepEqual(exportable(reordered).map((s) => s.key), ["alt:x"]);
  assert.ok(!exportText(exportable(list)).includes(SELF_ALT_URL));
});

// ---- versions and the minimum --------------------------------------------------------------------------------

test("minimumOf: AltStore minimumVersion, a Release's X-iFizBox-Minimum-Version, a saved record", () => {
  assert.equal(minimumOf({ minimumVersion: "0.1.3" }), "0.1.3");
  assert.equal(minimumOf({ fields: { "x-ifizbox-minimum-version": "v1.2" } }), "1.2.0");
  assert.equal(minimumOf({ minimumVersion: "soon" }), null);
  assert.equal(minimumOf({}), null);
  assert.equal(minimumOf(null), null);
});

test("refreshSource keeps the Release's minimum on the record (iFizBox's own repo)", async () => {
  const release = "Origin: iFizBox\nLabel: iFizBox\nArchitectures: iphoneos-arm64\nX-iFizBox-Minimum-Version: 0.1.3\n";
  const backend = {
    text: async (url) => { if (url.endsWith("Release")) return release; throw Object.assign(new Error("404"), { code: "not_found" }); },
    packages: async () => ({ text: "Package: com.ryha.ifizbox\nVersion: 0.1.4\nArchitecture: iphoneos-arm64\n" }),
  };
  const out = await refreshSource(backend, { uri: SELF_APT_URI, dist: "./", components: [] });
  assert.equal(out.minimumVersion, "0.1.3");
  assert.equal(minimumOf(out), "0.1.3");
});

const SOURCE = {
  name: "iFizBox",
  apps: [
    { bundleIdentifier: "com.example.other", versions: [{ version: "9.0", downloadURL: "https://x.example/o.ipa" }] },
    { bundleIdentifier: SELF_ID, minimumVersion: "0.1.2", versions: [
      { version: "0.1.1", date: "2026-11-01", downloadURL: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.1.1/iFizBox.ipa" },
      { version: "0.1.3", date: "2026-11-17", localizedDescription: "Essential Upgrade\nRelease notes: https://x", downloadURL: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.1.3/iFizBox.ipa", size: 10 },
    ] },
  ],
};

test("selfFromAltSource: the newest iFizBox (by version), its IPA, notes and minimum; only com.ryha.ifizbox", () => {
  const info = selfFromAltSource(JSON.stringify(SOURCE));
  assert.equal(info.version, "0.1.3");
  assert.match(info.ipa, /v0\.1\.3\/iFizBox\.ipa$/);
  assert.deepEqual(info.notes, ["Essential Upgrade"]);
  assert.equal(info.minimum, "0.1.2");
  assert.equal(selfFromAltSource({ apps: [SOURCE.apps[0]] }), null); // no other app is ever iFizBox
  assert.equal(selfFromAltSource("not json"), null);
});

test("selfUpgradeRow / withSelfUpgrade: iFizBox's row on top of Changes when newer, once", () => {
  const info = selfFromAltSource(SOURCE);
  const row = selfUpgradeRow(info, "0.1.1");
  assert.equal(row.id, SELF_ID);
  assert.equal(row.version, "0.1.3");
  assert.equal(row.installed, "0.1.1");
  assert.equal(row.key, altKey(SELF_ALT_URL));
  assert.equal(selfUpgradeRow(info, "0.1.3"), null);
  assert.equal(selfUpgradeRow(info, ""), null);
  const up = withSelfUpgrade({ available: [{ id: "a" }], ignored: [] }, row);
  assert.deepEqual(up.available.map((r) => r.id), [SELF_ID, "a"]);
  assert.deepEqual(withSelfUpgrade(up, row).available.length, 2);
  assert.deepEqual(withSelfUpgrade(up, null), up);
});

test("saveInfo / loadInfo keep what the last launch read", () => {
  const st = memStorage();
  assert.equal(loadInfo(st), null);
  saveInfo(st, { version: "0.1.3" });
  assert.deepEqual(loadInfo(st), { version: "0.1.3" });
});

// ---- iFizBox's own IPA in the sideload app ---------------------------------------------------------------------

function selfDeps({ answers = [] } = {}) {
  const log = [];
  const queue = [...answers];
  return {
    log,
    deps: {
      alert: async (spec) => { log.push(["alert", spec.title, spec.message]); return { index: queue.shift() ?? 0 }; },
      open: async (url) => log.push(["open", url]),
    },
  };
}
const ROW = { version: "0.1.3", ipa: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.1.3/iFizBox.ipa" };

test("installSelf (no bridge to sign with): it offers cydian.dev in Safari, which hands iFizBox to a sideloader (F89)", async () => {
  const s = selfDeps({ answers: [1] });
  assert.equal(await installSelf(ROW, s.deps), "site");
  assert.match(s.log[0][2], /cydian\.dev/);
  assert.match(s.log[0][2], /AltStore, SideStore or Feather/);
  assert.deepEqual(s.log[1], ["open", SELF_SITE]);
  const no = selfDeps({ answers: [0] });
  assert.equal(await installSelf(ROW, no.deps), "cancelled");
  assert.ok(!no.log.some((l) => l[0] === "open"));
});

test("installSelf: no IPA in the source says so", async () => {
  const s = selfDeps();
  assert.equal(await installSelf({ version: "0.1.3" }, s.deps), "no-asset");
});

test("the committed web/app/source.json reads as iFizBox's own source", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("../source.json", import.meta.url), "utf8");
  const info = selfFromAltSource(text);
  assert.ok(info?.version, "a version");
  assert.match(info.ipa, /^https:\/\/github\.com\/RyanAHayden\/iFizBox\/releases\/download\/v[\d.]+\/[\w.-]+\.ipa$/); // F171: releases before it carry the old asset name
});

test("F183: no Essential Upgrade alert is left to show", async () => {
  const mod = await import("./essential.js");
  for (const name of ["runEssential", "essentialAlert", "queueEssential", "belowMinimum", "TITLE", "MESSAGE"]) assert.equal(mod[name], undefined, name);
});

// F183: Home's Reload (and every launch) with a newer release on GitHub: no alert of any kind, and iFizBox's row on
// top of Changes, built as essential-ui.js upgradesWithSelf builds it.
test("F183: a reload with a newer release calls no alert and adds the iFizBox row to Changes", async () => {
  const { checkForUpdates, parseRelease, newerRelease } = await import("./selfupdate.js");
  const storage = memStorage();
  const alert = () => assert.fail("an update popup");
  const gh = parseRelease({ tag_name: "v0.5.0", body: "- Silent updates", assets: [
    { name: "iFizBox.ipa", browser_download_url: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.5.0/iFizBox.ipa" }] });
  let changed = 0;
  const r = await lookForSelfUpdate({
    mode: "sideload",
    readSource: async () => { saveInfo(storage, { version: "0.4.0", ipa: "https://x/0.4.0.ipa", notes: [] }); },
    checkRelease: () => checkForUpdates({ mode: "sideload", storage, current: async () => "0.3.0", release: async () => gh, alert }),
    changed: () => { changed++; },
    alert,
  });
  assert.equal(r, "checked");
  assert.equal(changed, 1);
  const info = selfInfoWith(loadInfo(storage), newerRelease(storage, "0.3.0"));
  const u = withSelfUpgrade({ available: [{ id: "tweak", version: "2" }], ignored: [] }, selfUpgradeRow(info, "0.3.0"));
  assert.deepEqual(u.available.map((x) => [x.id, x.version]), [[SELF_ID, "0.5.0"], ["tweak", "2"]]);
  assert.equal(u.available[0].ipa, gh.ipa);
  assert.equal(u.available[0].short, "Silent updates");
});

test("F183: selfInfoWith takes the newer of the source and GitHub (GitHub only with an IPA)", () => {
  const src = { version: "0.4.0", ipa: "s.ipa", notes: ["src"] };
  assert.equal(selfInfoWith(src, null), src);
  assert.equal(selfInfoWith(src, { version: "0.3.9", ipa: "g.ipa" }), src);
  assert.equal(selfInfoWith(src, { version: "0.4.1", ipa: null }), src);
  assert.equal(selfInfoWith(src, { version: "0.4.1", ipa: "g.ipa" }).ipa, "g.ipa");
  assert.equal(selfInfoWith(null, { version: "0.4.1", ipa: "g.ipa" }).version, "0.4.1");
  assert.equal(selfInfoWith(null, null), null);
});

test("F183: lookForSelfUpdate is silent on failures, reads no source in the jailbreak build, nothing on the site", async () => {
  const log = [];
  const deps = (mode) => ({ mode, readSource: async () => { log.push([mode, "source"]); throw new Error("offline"); },
    checkRelease: async () => { log.push([mode, "github"]); throw new Error("rate limit"); }, changed: () => log.push([mode, "changed"]) });
  assert.equal(await lookForSelfUpdate(deps("sideload")), "checked");
  assert.equal(await lookForSelfUpdate(deps("jailbreak")), "checked");
  assert.equal(await lookForSelfUpdate(deps("site")), "site");
  assert.deepEqual(log, [["sideload", "source"], ["sideload", "github"], ["sideload", "changed"], ["jailbreak", "github"], ["jailbreak", "changed"]]);
});

test("F183: app.js's launch, Reload and return check runs lookForUpdates and nothing that pops up", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../essential-ui.js", import.meta.url), "utf8");
  assert.match(app, /addEventListener\("ifizbox:reloaded", lookForSelf\)/);
  for (const gone of ["startEssential", "checkUpdates", "showBanner", "Updated to"]) assert.equal(app.includes(gone), false, gone);
  for (const gone of ["showBanner", "runEssential", "lock("]) assert.equal(ui.includes(gone), false, gone);
});
