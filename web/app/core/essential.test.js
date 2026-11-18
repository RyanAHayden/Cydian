// F72: Cydian's built-in source (always there, first, not removable, not exported), the essential detection, the
// minimum version, the alert and each of its buttons, and Cydian's own sideload install path.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  builtinSources, withBuiltins, withBuiltinRecords, builtinFirst, exportable, isBuiltin, BuiltinError,
  minimumOf, belowMinimum, selfFromAltSource, essentialIds, essentialUpgrades, selfUpgradeRow, withSelfUpgrade,
  essentialAlert, runEssential, installSelf, loadInfo, saveInfo,
  SELF_ID, SELF_APT_URI, SELF_ALT_URL, SELF_SITE, SERVER_OK_KEY, TITLE, MESSAGE, COMPLETE, ESSENTIAL_ONLY, IGNORE,
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
      const s = input === SELF_ALT_URL ? { key: altKey(input), uri: input, kind: "altstore", name: "Cydian", updated: 1 }
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
  assert.equal(list[0].name, "Cydian");
  assert.equal(isBuiltin(list[1]), false);
});

test("withBuiltins: a stored built-in keeps its fields and moves first", async () => {
  const stored = { key: altKey(SELF_ALT_URL), uri: SELF_ALT_URL, name: "Cydian", count: 1, updated: 5 };
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

test("minimumOf: AltStore minimumVersion, a Release's X-Cydian-Minimum-Version, a saved record", () => {
  assert.equal(minimumOf({ minimumVersion: "0.1.3" }), "0.1.3");
  assert.equal(minimumOf({ fields: { "x-cydian-minimum-version": "v1.2" } }), "1.2.0");
  assert.equal(minimumOf({ minimumVersion: "soon" }), null);
  assert.equal(minimumOf({}), null);
  assert.equal(minimumOf(null), null);
});

test("belowMinimum: the version compare", () => {
  assert.equal(belowMinimum("0.1.2", "0.1.3"), true);
  assert.equal(belowMinimum("0.1.3", "0.1.3"), false);
  assert.equal(belowMinimum("0.2.0", "0.1.3"), false);
  assert.equal(belowMinimum("0.1.10", "0.1.9"), false); // numbers, not strings
  assert.equal(belowMinimum("0.1.1", null), false);
  assert.equal(belowMinimum("", "0.1.3"), false); // unknown (the site): never forced
});

test("refreshSource keeps the Release's minimum on the record (Cydian's own repo)", async () => {
  const release = "Origin: Cydian\nLabel: Cydian\nArchitectures: iphoneos-arm64\nX-Cydian-Minimum-Version: 0.1.3\n";
  const backend = {
    text: async (url) => { if (url.endsWith("Release")) return release; throw Object.assign(new Error("404"), { code: "not_found" }); },
    packages: async () => ({ text: "Package: com.ryha.cydian\nVersion: 0.1.4\nArchitecture: iphoneos-arm64\n" }),
  };
  const out = await refreshSource(backend, { uri: SELF_APT_URI, dist: "./", components: [] });
  assert.equal(out.minimumVersion, "0.1.3");
  assert.equal(minimumOf(out), "0.1.3");
});

const SOURCE = {
  name: "Cydian",
  apps: [
    { bundleIdentifier: "com.example.other", versions: [{ version: "9.0", downloadURL: "https://x.example/o.ipa" }] },
    { bundleIdentifier: SELF_ID, minimumVersion: "0.1.2", versions: [
      { version: "0.1.1", date: "2026-11-01", downloadURL: "https://github.com/RyanAHayden/Cydian/releases/download/v0.1.1/Cydian.ipa" },
      { version: "0.1.3", date: "2026-11-17", localizedDescription: "Essential Upgrade\nRelease notes: https://x", downloadURL: "https://github.com/RyanAHayden/Cydian/releases/download/v0.1.3/Cydian.ipa", size: 10 },
    ] },
  ],
};

test("selfFromAltSource: the newest Cydian (by version), its IPA, notes and minimum; only com.ryha.cydian", () => {
  const info = selfFromAltSource(JSON.stringify(SOURCE));
  assert.equal(info.version, "0.1.3");
  assert.match(info.ipa, /v0\.1\.3\/Cydian\.ipa$/);
  assert.deepEqual(info.notes, ["Essential Upgrade"]);
  assert.equal(info.minimum, "0.1.2");
  assert.equal(selfFromAltSource({ apps: [SOURCE.apps[0]] }), null); // no other app is ever Cydian
  assert.equal(selfFromAltSource("not json"), null);
});

test("selfUpgradeRow / withSelfUpgrade: Cydian's row on top of Changes when newer, once", () => {
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

// ---- essential detection -------------------------------------------------------------------------------------

test("essentialIds / essentialUpgrades: Cydian, apt, dpkg and installed Essential: yes packages; nothing else", () => {
  const ids = essentialIds([{ id: "base", essential: true }, { id: "tweak", essential: false }]);
  for (const id of [SELF_ID, "apt", "dpkg", "base"]) assert.ok(ids.has(id), id);
  assert.ok(!ids.has("tweak"));
  const available = [{ id: "tweak", version: "2" }, { id: "dpkg", version: "1.22" }, { id: SELF_ID, version: "0.1.3" }];
  assert.deepEqual(essentialUpgrades(available, ids).map((r) => r.id), ["dpkg", SELF_ID]);
  assert.deepEqual(essentialUpgrades([{ id: "tweak" }], ids), []);
});

// ---- the alert and its buttons -------------------------------------------------------------------------------

test("essentialAlert: Cydia's buttons; below the minimum there is no Ignore", () => {
  const a = essentialAlert();
  assert.equal(a.title, TITLE);
  assert.equal(a.title, "Essential Upgrade");
  assert.equal(a.message, MESSAGE);
  assert.equal(a.message, "Cydian needs to upgrade itself before it can do anything else.");
  assert.deepEqual(a.buttons, ["Complete Upgrade", "Essential Only", "Ignore (Temporary)"]);
  assert.equal(a.buttons[a.cancel], IGNORE);
  const f = essentialAlert({ forced: true, minimum: "0.1.3" });
  assert.deepEqual(f.buttons, [COMPLETE, ESSENTIAL_ONLY]);
  assert.ok(!f.buttons.includes(IGNORE));
  assert.equal(f.buttons[f.cancel], undefined); // Escape taps nothing
  assert.match(f.message, /0\.1\.3/);
});

function runDeps(info, answers) {
  const log = [];
  const queue = [...answers];
  return {
    log,
    deps: {
      gather: async () => info,
      alert: async (spec) => { log.push(["alert", spec.buttons]); return { index: queue.shift() ?? 2 }; },
      complete: async (all) => log.push(["complete", all.map((r) => r.id)]),
      essentialOnly: async (rows) => log.push(["essential", rows.map((r) => r.id)]),
      lock: () => log.push(["lock"]),
    },
  };
}

const INFO = { current: "0.1.1", minimum: null,
  essential: [{ id: SELF_ID, version: "0.1.3" }], all: [{ id: SELF_ID, version: "0.1.3" }, { id: "tweak", version: "2" }] };

test("runEssential: nothing to read, or nothing essential: no alert", async () => {
  let r = runDeps(null, []);
  assert.equal(await runEssential(r.deps), "unknown");
  r = runDeps({ ...INFO, essential: [] }, []);
  assert.equal(await runEssential(r.deps), "none");
  assert.deepEqual(r.log, []);
  r = runDeps(INFO, []);
  r.deps.gather = async () => { throw new Error("offline"); };
  assert.equal(await runEssential(r.deps), "unknown");
});

test("runEssential: Complete Upgrade takes every upgrade in Changes", async () => {
  const r = runDeps(INFO, [0]);
  assert.equal(await runEssential(r.deps), "complete");
  assert.deepEqual(r.log, [["alert", [COMPLETE, ESSENTIAL_ONLY, IGNORE]], ["complete", [SELF_ID, "tweak"]]]);
});

test("runEssential: Essential Only takes just the essential ones", async () => {
  const r = runDeps(INFO, [1]);
  assert.equal(await runEssential(r.deps), "essential");
  assert.deepEqual(r.log.at(-1), ["essential", [SELF_ID]]);
});

test("runEssential: Ignore (Temporary) does nothing and keeps nothing (the next launch asks again)", async () => {
  const r = runDeps(INFO, [2]);
  assert.equal(await runEssential(r.deps), "ignored");
  assert.deepEqual(r.log, [["alert", [COMPLETE, ESSENTIAL_ONLY, IGNORE]]]);
  const again = runDeps(INFO, [2]);
  assert.equal(await runEssential(again.deps), "ignored"); // asks again
});

test("runEssential: below the minimum the UI is locked, the alert has no Ignore, and a dismissal asks again", async () => {
  const r = runDeps({ ...INFO, minimum: "0.1.2" }, [-1, 1]);
  assert.equal(await runEssential(r.deps), "essential");
  assert.deepEqual(r.log, [["lock"], ["alert", [COMPLETE, ESSENTIAL_ONLY]], ["alert", [COMPLETE, ESSENTIAL_ONLY]], ["essential", [SELF_ID]]]);
  // At the minimum: Ignore is back.
  const ok = runDeps({ ...INFO, current: "0.1.2", minimum: "0.1.2" }, [2]);
  assert.equal(await runEssential(ok.deps), "ignored");
});

// ---- Cydian's own IPA in the sideload app ---------------------------------------------------------------------

function selfDeps({ identity = null, answers = [], sign = async () => "itms-services://?action=download-manifest&url=x", storage = memStorage() } = {}) {
  const log = [];
  const queue = [...answers];
  return {
    log, storage,
    deps: {
      exportIdentity: async () => identity, server: "https://cydian.dev", storage,
      signOnServer: async (o) => { log.push(["sign", o.url, o.server]); return sign(o); },
      alert: async (spec) => { log.push(["alert", spec.title, spec.message]); return { index: queue.shift() ?? 0 }; },
      open: async (url) => log.push(["open", url]),
    },
  };
}
const ROW = { version: "0.1.3", ipa: "https://github.com/RyanAHayden/Cydian/releases/download/v0.1.3/Cydian.ipa" };
const ID = { p12: new Uint8Array([1]), profile: new Uint8Array([2]), password: "" };

test("installSelf: with a certificate it asks once, explaining the key goes to the server, then opens its itms link", async () => {
  const s = selfDeps({ identity: ID, answers: [1] });
  assert.equal(await installSelf(ROW, s.deps), "installing");
  assert.equal(s.log[0][0], "alert");
  assert.match(s.log[0][1], /cydian\.dev/);
  assert.match(s.log[0][2], /iOS closes Cydian/);
  assert.match(s.log[0][2], /key go to cydian\.dev for this one request/);
  assert.deepEqual(s.log[1], ["sign", ROW.ipa, "https://cydian.dev"]);
  assert.equal(s.log[2][0], "open");
  assert.match(s.log[2][1], /^itms-services:/);
  assert.equal(s.storage.getItem(SERVER_OK_KEY), "cydian.dev");
  // Asked once: the second time signs straight away.
  const again = selfDeps({ identity: ID, storage: s.storage });
  assert.equal(await installSelf(ROW, again.deps), "installing");
  assert.deepEqual(again.log.map((l) => l[0]), ["sign", "open"]);
});

test("installSelf: Cancel on the ask sends nothing", async () => {
  const s = selfDeps({ identity: ID, answers: [0] });
  assert.equal(await installSelf(ROW, s.deps), "cancelled");
  assert.deepEqual(s.log.map((l) => l[0]), ["alert"]);
});

test("installSelf: a server error is said plainly", async () => {
  const s = selfDeps({ identity: ID, answers: [1, 0], sign: async () => { throw new Error("The signing server answered HTTP 500."); } });
  assert.equal(await installSelf(ROW, s.deps), "failed");
  assert.deepEqual(s.log.at(-1).slice(0, 3), ["alert", "Couldn't Sign Cydian", "The signing server answered HTTP 500."]);
});

test("installSelf: without a certificate to send, it offers Settings > Signing or cydian.dev, never the local server", async () => {
  const s = selfDeps({ answers: [1] });
  assert.equal(await installSelf(ROW, s.deps), "site");
  assert.match(s.log[0][2], /Settings > Signing/);
  assert.match(s.log[0][2], /cydian\.dev/);
  assert.deepEqual(s.log[1], ["open", SELF_SITE]);
  assert.ok(!s.log.some((l) => l[0] === "sign"));
  const no = selfDeps({ answers: [0] });
  assert.equal(await installSelf(ROW, no.deps), "cancelled");
  assert.ok(!no.log.some((l) => l[0] === "open"));
});

test("installSelf: an exportIdentity that throws (an older shell) is the no-certificate path", async () => {
  const s = selfDeps({ answers: [1] });
  s.deps.exportIdentity = async () => { throw new Error("unknown method signing.export"); };
  assert.equal(await installSelf(ROW, s.deps), "site");
});

test("installSelf: no IPA in the source says so", async () => {
  const s = selfDeps();
  assert.equal(await installSelf({ version: "0.1.3" }, s.deps), "no-asset");
});

test("the committed web/app/source.json reads as Cydian's own source", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("../source.json", import.meta.url), "utf8");
  const info = selfFromAltSource(text);
  assert.ok(info?.version, "a version");
  assert.match(info.ipa, /^https:\/\/github\.com\/RyanAHayden\/Cydian\/releases\/download\/v[\d.]+\/Cydian\.ipa$/);
});

test("F61's sideload install takes installSelf when given (never the local server for Cydian itself)", async () => {
  const { runInstall } = await import("./selfupdate.js");
  const log = [];
  const deps = {
    status: async () => { log.push("status"); return { identity: null }; },
    installOnDevice: async () => { log.push("local"); return true; },
    installSelf: async (row) => { log.push(["self", row.version, row.ipa]); return "site"; },
    alert: async () => ({ index: 0 }), go: () => {},
  };
  assert.equal(await runInstall({ version: "0.1.3", ipa: ROW.ipa }, "sideload", deps), "installed");
  assert.deepEqual(log, [["self", "0.1.3", ROW.ipa]]);
  deps.installSelf = async () => "cancelled";
  assert.equal(await runInstall({ version: "0.1.3", ipa: ROW.ipa }, "sideload", deps), "failed");
});
