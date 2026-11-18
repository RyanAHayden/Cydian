// F72: iFizBox's built-in source (always there, first, not removable, not exported), the essential detection, the
// minimum version, the alert and each of its buttons, and iFizBox's own sideload install path.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  builtinSources, withBuiltins, withBuiltinRecords, builtinFirst, exportable, isBuiltin, BuiltinError,
  minimumOf, belowMinimum, selfFromAltSource, essentialIds, essentialUpgrades, selfUpgradeRow, withSelfUpgrade,
  essentialAlert, runEssential, queueEssential, installSelf, loadInfo, saveInfo,
  SELF_ID, SELF_APT_URI, SELF_ALT_URL, SELF_SITE, TITLE, MESSAGE, COMPLETE, ESSENTIAL_ONLY, IGNORE,
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

test("refreshSource keeps the Release's minimum on the record (iFizBox's own repo)", async () => {
  const release = "Origin: iFizBox\nLabel: iFizBox\nArchitectures: iphoneos-arm64\nX-Cydian-Minimum-Version: 0.1.3\n";
  const backend = {
    text: async (url) => { if (url.endsWith("Release")) return release; throw Object.assign(new Error("404"), { code: "not_found" }); },
    packages: async () => ({ text: "Package: com.ryha.cydian\nVersion: 0.1.4\nArchitecture: iphoneos-arm64\n" }),
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
      { version: "0.1.1", date: "2026-11-01", downloadURL: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.1.1/Cydian.ipa" },
      { version: "0.1.3", date: "2026-11-17", localizedDescription: "Essential Upgrade\nRelease notes: https://x", downloadURL: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.1.3/Cydian.ipa", size: 10 },
    ] },
  ],
};

test("selfFromAltSource: the newest iFizBox (by version), its IPA, notes and minimum; only com.ryha.cydian", () => {
  const info = selfFromAltSource(JSON.stringify(SOURCE));
  assert.equal(info.version, "0.1.3");
  assert.match(info.ipa, /v0\.1\.3\/Cydian\.ipa$/);
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

// ---- essential detection -------------------------------------------------------------------------------------

test("essentialIds / essentialUpgrades: iFizBox, apt, dpkg and installed Essential: yes packages; nothing else", () => {
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
  assert.equal(a.message, "iFizBox needs to upgrade itself before it can do anything else.");
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

// ---- F86: both buttons queue and open Confirm ---------------------------------------------------------------

// The alert's buttons as essential-ui.js binds them: queueEssential over a fake queue whose first add opens a fake
// Confirm sheet; `endings` are how each Confirm goes away ("confirm" | "cancel" | "closed").
function queueDeps(info, answers, endings) {
  const r = runDeps(info, answers);
  const queued = [], opened = [];
  const ends = [...endings];
  const button = (name) => (rows) => queueEssential(rows, {
    queue: async (list) => { queued.push([name, list.map((x) => x.id)]); opened.push(name); r.log.push(["confirm", name]); return list.length; },
    confirmed: async () => { const how = ends.shift() ?? "confirm"; r.log.push([how]); return how; },
    fallback: async () => { r.log.push(["fallback"]); return "failed"; },
  });
  r.deps.complete = button("complete");
  r.deps.essentialOnly = button("essential");
  return { ...r, queued, opened };
}

test("F86: Complete Upgrade queues every upgrade and opens Confirm", async () => {
  const r = queueDeps(INFO, [0], ["confirm"]);
  assert.equal(await runEssential(r.deps), "complete");
  assert.deepEqual(r.queued, [["complete", [SELF_ID, "tweak"]]]);
  assert.deepEqual(r.log, [["alert", [COMPLETE, ESSENTIAL_ONLY, IGNORE]], ["confirm", "complete"], ["confirm"]]);
});

test("F86: Essential Only queues just the essential ones and opens Confirm", async () => {
  const r = queueDeps(INFO, [1], ["confirm"]);
  assert.equal(await runEssential(r.deps), "essential");
  assert.deepEqual(r.queued, [["essential", [SELF_ID]]]);
  assert.deepEqual(r.opened, ["essential"]);
});

test("F86: Confirm's Cancel: forced, the alert comes back; not forced, it's over", async () => {
  const forced = queueDeps({ ...INFO, minimum: "0.1.2" }, [0, 1], ["cancel", "confirm"]);
  assert.equal(await runEssential(forced.deps), "essential");
  assert.deepEqual(forced.log, [["lock"], ["alert", [COMPLETE, ESSENTIAL_ONLY]], ["confirm", "complete"], ["cancel"],
    ["alert", [COMPLETE, ESSENTIAL_ONLY]], ["confirm", "essential"], ["confirm"]]);
  const free = queueDeps(INFO, [1], ["cancel"]);
  assert.equal(await runEssential(free.deps), "cancelled");
  assert.equal(free.log.filter((e) => e[0] === "alert").length, 1);
});

test("F86: Continue Queuing keeps the queue and doesn't ask again; nothing queuable falls back", async () => {
  const r = queueDeps({ ...INFO, minimum: "0.1.2" }, [1], ["closed"]);
  assert.equal(await runEssential(r.deps), "essential");
  assert.equal(r.log.filter((e) => e[0] === "alert").length, 1);
  const none = await queueEssential([{ id: SELF_ID }], { queue: async () => 0, confirmed: async () => assert.fail("no Confirm"),
    fallback: async () => "no-asset" });
  assert.equal(none, "no-asset");
  assert.equal(await queueEssential([], { queue: async () => { throw new Error("x"); }, confirmed: async () => "confirm" }), "failed");
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
const ROW = { version: "0.1.3", ipa: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.1.3/Cydian.ipa" };

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
  assert.match(info.ipa, /^https:\/\/github\.com\/RyanAHayden\/iFizBox\/releases\/download\/v[\d.]+\/(?:Cydian|iFizBox)\.ipa$/);
});

test("F61's sideload install takes installSelf when given (never the local server for iFizBox itself)", async () => {
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

test("a iFizBox update above the minimum: a banner (notify) instead of the alert; below it, the alert still blocks", async () => {
  const { runEssential } = await import("./essential.js");
  const row = { id: "com.ryha.cydian", version: "0.4.0" };
  let notified = null, alerts = 0, queued = null;
  const deps = (minimum) => ({ gather: async () => ({ current: "0.3.5", minimum, essential: [row], all: [row] }),
    alert: async () => { alerts++; return { index: 1 }; }, complete: async () => {}, essentialOnly: async (r) => { queued = r; },
    notify: (rows, upgrade) => { notified = rows; upgrade(); } });
  assert.equal(await runEssential(deps("0.3.0")), "notified");
  assert.deepEqual([notified, queued, alerts], [[row], [row], 0]); // Upgrade on the banner queues it
  assert.equal(await runEssential(deps("0.4.0")), "essential");
  assert.equal(alerts, 1);
});
