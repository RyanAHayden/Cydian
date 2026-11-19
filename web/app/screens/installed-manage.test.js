// F222: Installed's Manage mode: the selection presets, the toolbar's counts and enabled state, the jobs each toolbar
// button queues (against fake queues, runners and a fake native bridge), B46's per-app Delete rules in bulk, and
// Manage keeping the User/Recent mode.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { manageKinds, manageable, presetIds, selectSheet, selectLabel, manageCounts, manageSummary, manageToolbar, pruneSelection,
  SELECT, DESELECT, MANAGE_PRESETS } from "../core/installed.js";
import { withManage, fromMyIpas, manageJobs, manageSheet, bulkDeletePlan, bulkDeleteSheet, runManage, runManageJobs, manageInstall,
  bulkHud, selectButton, togglePick, setManaging, pickMode, pageStates, withSignatures, extraRow, appSections, HOME_SCREEN, REMOVE } from "./installed.js";
import { createAppQueue } from "../core/appqueue.js";

const DAY = 86400000;
const now = new Date("2026-11-18T12:00:00Z");
const pkg = (id, versions) => ({ key: `alt:${id}`, row: { id, name: id }, stanza: { kind: "ipa", version: versions[0].version,
  ipa: { bundleIdentifier: id, name: id.toUpperCase(), sourceUrl: "https://s/", versions } } });
const v = (version) => ({ version, downloadURL: `https://s/${version}.ipa`, size: 1000 });

// The list as drawAppList builds it: signed (ok, soon, expired), a marked app on its source, one off it, one with an
// update, iFizBox's own row and a My IPAs app iFizBox signed but doesn't remember.
function fixture() {
  const exp = (days) => new Date(now.getTime() + days * DAY).toISOString();
  const signed = { apps: [
    { bundleId: "ok", name: "Ok", version: "1", expires: exp(20) },
    { bundleId: "soon", name: "Delta", version: "1", expires: exp(2) },
    { bundleId: "dead", name: "Dead", version: "1", expires: exp(-1) },
    { bundleId: "mine.x", name: "Mine", version: "3", expires: exp(30), url: "library:Mine.ipa" },
  ] };
  const records = [
    { id: "ok", name: "Ok", version: "1" }, { id: "soon", name: "Delta", version: "1" }, { id: "dead", name: "Dead", version: "1" },
    { id: "m", name: "Marked", version: "2", sourceName: "S" }, { id: "gone", name: "Gone", version: "0.1" },
    { id: "up", name: "Up", version: "1", upgrade: "2", sourceName: "S" }, { id: "self", name: "Me", version: "9", self: true },
  ];
  const cands = new Map([
    ["m", { version: "3", key: "alt:m", pkg: pkg("m", [v("3"), v("2")]) }],
    ["gone", { version: "1", key: "alt:gone", pkg: pkg("gone", [v("1")]) }],
    ["up", { version: "2", key: "alt:up", pkg: pkg("up", [v("2"), v("1")]) }],
  ]);
  const s = withSignatures(records, signed, { now, window: 3, marked: true });
  const index = new Map(signed.apps.map((a) => [a.bundleId, a]));
  return [...s.rows, ...s.extra].map((r) => withManage({ ...r, signed: index.get(r.id) ?? null }, cands));
}
const ids = (rows) => rows.map((r) => r.id);

test("the rows Manage picks: every app but iFizBox's own, with what each toolbar button can do", () => {
  const rows = fixture();
  assert.deepEqual(ids(manageable(rows)), ["ok", "soon", "dead", "m", "gone", "up", "mine.x"]);
  assert.equal(manageKinds(rows.find((r) => r.id === "self")), null);
  const k = Object.fromEntries(manageable(rows).map((r) => [r.id, manageKinds(r)]));
  assert.deepEqual(k.soon, { resign: true, update: false, expiring: true, marked: false, blocked: false });
  assert.deepEqual(k.m, { resign: true, update: false, expiring: false, marked: true, blocked: false }); // its installed version is on the source
  assert.deepEqual(k.gone, { resign: false, update: false, expiring: false, marked: true, blocked: true }); // 0.1 left the source
  assert.deepEqual(k.up, { resign: true, update: true, expiring: false, marked: true, blocked: false }); // 1 is still on the source too
  assert.equal(k["mine.x"].resign, true);
});

test("Select…'s presets: All Apps, Expiring Soon (n), Not Signed Here (n), With Updates (n); Deselect once all are picked", () => {
  const rows = fixture();
  assert.deepEqual(MANAGE_PRESETS, ["all", "expiring", "marked", "updates"]);
  assert.deepEqual(selectSheet(rows).map((o) => o.label), ["All Apps", "Expiring Soon (2)", "Not Signed Here (3)", "With Updates (1)"]);
  assert.deepEqual(presetIds(rows, "expiring"), ["soon", "dead"]); // inside the re-sign window, and past it
  assert.deepEqual(presetIds(rows, "marked"), ["m", "gone", "up"]);
  assert.deepEqual(presetIds(rows, "updates"), ["up"]);
  assert.equal(presetIds(rows, "all").length, 7);
  assert.deepEqual(presetIds(rows, "nope"), []);
  assert.equal(selectLabel(rows, new Set()), SELECT);
  assert.equal(SELECT, "Select…");
  assert.equal(selectLabel(rows, new Set(presetIds(rows, "all"))), DESELECT);
  assert.equal(selectLabel([], new Set()), SELECT);
});

test("selectButton: a preset's apps replace the selection; Deselect drops it", async () => {
  const view = { manageRows: fixture(), selected: new Set(["ok"]) };
  let asked = null;
  let synced = 0;
  const sync = () => synced++;
  assert.equal(await selectButton({ view, sync, sheet: async (o) => { asked = o; return 1; } }), "expiring");
  assert.deepEqual(asked.buttons[0], "All Apps");
  assert.deepEqual([...view.selected], ["soon", "dead"]);
  assert.equal(await selectButton({ view, sync, sheet: async () => -1 }), null); // Cancel
  assert.deepEqual([...view.selected], ["soon", "dead"]);
  await selectButton({ view, sync, sheet: async () => 0 });
  assert.equal(view.selected.size, 7);
  assert.equal(await selectButton({ view, sync, sheet: async () => assert.fail("no sheet for Deselect") }), "none");
  assert.equal(view.selected.size, 0);
  assert.equal(synced, 3);
});

test("toolbar: Re-sign (n), Update (n) counting only picked apps with an update, Delete (n); disabled at 0", () => {
  const rows = fixture();
  assert.deepEqual(manageToolbar(manageCounts(rows, new Set())), [
    { kind: "resign", label: "Re-sign", disabled: true }, { kind: "update", label: "Update", disabled: true },
    { kind: "delete", label: "Delete", disabled: true }]);
  const c = manageCounts(rows, new Set(["soon", "m", "gone", "up", "self"])); // iFizBox's own isn't pickable
  assert.deepEqual(c, { n: 4, resign: 3, update: 1, del: 4, marked: 2, blocked: 1 }); // Gone's version left its source: not counted
  assert.deepEqual(manageToolbar(c).map((b) => [b.label, b.disabled]), [["Re-sign (3)", false], ["Update (1)", false], ["Delete (4)", false]]);
  // B66: Gone alone: Re-sign stays tappable (no count: nothing it can sign as is) and says why when tapped
  assert.deepEqual(manageToolbar(manageCounts(rows, new Set(["gone"]))).map((b) => [b.label, b.disabled]),
    [["Re-sign", false], ["Update", true], ["Delete (1)", false]]);
});

test("the grey line: N selected · X apps · Y expiring · Z updates", () => {
  const rows = fixture();
  assert.equal(manageSummary(rows, new Set()), "0 selected · 7 apps · 2 expiring · 1 update");
  assert.equal(manageSummary(rows, new Set(["ok", "up"])), "2 selected · 7 apps · 2 expiring · 1 update");
  assert.equal(manageSummary(rows.slice(0, 1), new Set(["ok"])), "1 selected · 1 app · 0 expiring · 0 updates");
  assert.deepEqual([...pruneSelection(new Set(["ok", "deleted", "self"]), rows)], ["ok"]);
});

test("From My IPAs: a signed app the list doesn't remember, made from the user's own IPA, says so", () => {
  assert.equal(fromMyIpas({ url: "library:Mine.ipa" }), true);
  assert.equal(fromMyIpas({ url: "https://s/a.ipa" }), false);
  assert.equal(fromMyIpas(null), false);
  const mine = fixture().find((r) => r.id === "mine.x");
  assert.equal(mine.fromMyIpas, true);
  const route = { tab: "installed", path: [] };
  assert.equal(extraRow(route)(mine).subtitle, "Version 3 · From My IPAs");
  assert.match(extraRow(route)({ ...mine, fromMyIpas: false }).subtitle, /^Version 3 · Signed by /);
});

test("manageJobs: Re-sign from the signature record (My IPAs' from its file) or a marked app's source IPA; Update the newest", () => {
  const rows = fixture();
  const pick = (...want) => rows.filter((r) => want.includes(r.id));
  const re = manageJobs("resign", pick("soon", "m", "gone", "mine.x", "up"));
  assert.deepEqual(re.map((j) => [j.id, j.mode, j.url ?? null]), [["soon", "resign", null], ["m", "resign", "https://s/2.ipa"],
    ["up", "resign", "https://s/1.ipa"], ["mine.x", "resign", null]]); // Gone's 0.1 isn't on its source: left out
  const up = manageJobs("update", pick("soon", "up"));
  assert.deepEqual(up.map((j) => [j.id, j.version, j.installed, j.url]), [["up", "2", "1", "https://s/2.ipa"]]);
  assert.deepEqual(manageJobs("delete", pick("soon")), []);
});

test("the confirm sheets: Re-sign says each app keeps its data, and when marked apps are downloaded first", () => {
  assert.deepEqual(manageSheet("resign", 3), { title: "Each app keeps its data.", button: "Re-sign 3 Apps" });
  assert.equal(manageSheet("resign", 3, 1).title, "Each app keeps its data. 1 app is downloaded from its source first.");
  assert.equal(manageSheet("resign", 3, 2).title, "Each app keeps its data. 2 apps are downloaded from their sources first.");
  assert.equal(manageSheet("resign", 1).button, "Re-sign App");
  assert.equal(manageSheet("update", 2).button, "Update 2 Apps");
});

test("bulk Delete follows B46 per app: the sideload app removes what iOS no longer has, keeps what it has", () => {
  const rows = [{ id: "a", name: "A", installed: true }, { id: "b", name: "B", installed: false }, { id: "c", name: "C" }, { id: "s", name: "S", self: true }];
  const side = bulkDeletePlan(rows, { mode: "sideload" });
  assert.deepEqual([side.act.map((x) => x.r.id), side.stay.map((r) => r.id)], [["b", "c"], ["a"]]);
  assert.deepEqual(bulkDeleteSheet(side), { title: `Removes 2 apps from the list. ${HOME_SCREEN} A is still on your iPhone and stays on the list.`,
    button: "Remove 2 Apps from List" });
  assert.deepEqual(bulkDeleteSheet(bulkDeletePlan(rows.slice(1, 2), { mode: "site" })), { title: `Removes 1 app from the list. ${HOME_SCREEN}`, button: REMOVE });
  assert.equal(bulkDeleteSheet(bulkDeletePlan(rows.slice(0, 1), { mode: "sideload" })).button, null); // only explains
  const jb = bulkDeletePlan([{ id: "x", name: "X", actual: "1" }, { id: "y", name: "Y", actual: "2" }], { mode: "jailbreak" });
  assert.deepEqual(bulkDeleteSheet(jb), { title: "Deletes 2 apps and their data from your iPhone.", button: "Delete 2 Apps" });
});

test("runManage: each toolbar button confirms, then queues its kind's jobs; Delete removes per app", async () => {
  const view = { manageRows: fixture(), selected: new Set(["soon", "m", "up", "gone"]) };
  const ran = [];
  let sheet = null;
  let ended = 0;
  const base = { view, mode: "sideload", done: () => ended++, run: async (kind, jobs) => ran.push([kind, jobs.map((j) => j.id)]),
    busy: async () => false, alert: async (o) => ({ index: o.buttons.indexOf("Re-sign the Other 3") }) }; // Gone: B66's alert, skipped
  assert.equal(await runManage("resign", { ...base, sheet: async (o) => { sheet = o; return 0; } }), true);
  assert.deepEqual(sheet, { title: "Each app keeps its data. 2 apps are downloaded from their sources first.", buttons: ["Re-sign 3 Apps"] });
  assert.equal(await runManage("update", { ...base, sheet: async (o) => { sheet = o; return 0; } }), true);
  assert.deepEqual(sheet.buttons, ["Update App"]);
  assert.equal(await runManage("update", { ...base, sheet: async () => -1 }), false); // Cancel: nothing runs
  assert.deepEqual(ran, [["resign", ["soon", "m", "up"]], ["update", ["up"]]]);
  const removed = [];
  view.manageRows = view.manageRows.map((r) => (r.id === "soon" ? { ...r, installed: true } : r)); // iOS still has Delta
  assert.equal(await runManage("delete", { ...base, sheet: async (o) => { sheet = o; return 0; }, remove: async (a, r) => removed.push([r.id, a.kind]) }), true);
  assert.deepEqual(removed, [["m", "forget"], ["gone", "forget"], ["up", "forget"]]); // in the list's order
  assert.match(sheet.title, /Delta is still on your iPhone/);
  assert.equal(ended, 3);
  assert.equal(await runManage("resign", { ...base, view: { manageRows: view.manageRows, selected: new Set() }, sheet: async () => assert.fail() }), false);
});

test("runManageJobs: the jobs go through the app queue's run, each labelled 'Re-signing Delta (1 of 3)'", async () => {
  const q = createAppQueue();
  const jobs = [{ id: "a", name: "Delta", mode: "resign" }, { id: "b", name: "Bee", mode: "resign" }, { id: "c", name: "Cee", mode: "resign" }];
  const seen = [];
  let queuedAtRun = null;
  const run = async (js, { queue, install }) => {
    queuedAtRun = queue.list().map((j) => j.op);
    for (const j of js) await install(j);
    for (const j of js) queue.clear(j.id);
    return js.length;
  };
  assert.deepEqual(await runManageJobs("resign", jobs, { queue: q, run, install: async (j, o) => seen.push(`${o.verb} ${j.name} (${o.i} of ${o.n})`) }),
    { done: 3, left: [] });
  assert.deepEqual(queuedAtRun, ["resign", "resign", "resign"]);
  assert.deepEqual(seen, ["Re-signing Delta (1 of 3)", "Re-signing Bee (2 of 3)", "Re-signing Cee (3 of 3)"]);
});

test("bulkHud: the label keeps the app and its place, the bar shows the run's progress, phases go to the log", () => {
  const got = { set: [], raw: [], first: null };
  const factory = (t) => { got.first = t; return { set: (x) => got.set.push(x), done: () => "done", page: { raw: (x) => got.raw.push(x) } }; };
  const h = bulkHud(factory, { verb: "Re-signing", name: "Delta", i: 2, n: 4 })("Re-signing");
  assert.equal(got.first, "Re-signing Delta (2 of 4) 25%");
  h.set("Signing 50%");
  h.set("Installing");
  assert.deepEqual(got.set, ["Re-signing Delta (2 of 4) 38%", "Re-signing Delta (2 of 4) 38%"]);
  assert.deepEqual(got.raw, ["Signing", "Installing"]); // B65: the phase, not each percent
  assert.equal(h.done(), "done"); // the rest is the page's own
});

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("manageInstall against a fake native bridge: a record re-sign is signing.resign, an update signing.install", async () => {
  const calls = [];
  const native = { mode: "sideload", call: async (m, p) => { calls.push([m, p.bundleId ?? p.url]); return m === "signing.resign" ? { done: [p.bundleId] } : { bundleId: "up" }; } };
  globalThis.ifizboxNative = native;
  const labels = [];
  const hud = (t) => { labels.push(t); return { set: (x) => labels.push(x), done: () => {}, hide: () => {}, fail: () => {} }; };
  const { resignApp } = await import("./queue.js");
  const sc = { localSigning: () => true, isSelfIpa: () => false, getServer: () => "https://sign",
    installOnDevice: async (o, deps) => { deps.hud("Downloading").set("Downloading 40%"); calls.push(["signing.install", o.url]); return true; } };
  assert.equal(await manageInstall({ id: "soon", name: "Delta", mode: "resign" }, { verb: "Re-signing", i: 1, n: 2, hud, sc,
    resign: (job, o) => resignApp(job, { ...o, native }) }), true);
  assert.equal(await manageInstall({ id: "up", name: "Up", mode: "upgrade", url: "https://s/2.ipa" }, { verb: "Updating", i: 2, n: 2, hud, sc }), true);
  assert.deepEqual(calls, [["signing.resign", "soon"], ["signing.install", "https://s/2.ipa"]]);
  assert.equal(labels[0], "Re-signing Delta (1 of 2) 0%");
  assert.ok(labels.includes("Updating Up (2 of 2) 70%"));
});

test("Manage keeps the User/Recent mode, and the mode keeps Manage; Done drops the selection", () => {
  globalThis.ifizboxNative = { mode: "sideload" };
  const { apps } = pageStates();
  apps.manageRows = fixture();
  apps.mode = "recent";
  setManaging(true);
  assert.equal(apps.managing, true);
  assert.equal(apps.mode, "recent");
  togglePick("ok");
  togglePick("up");
  togglePick("ok");
  assert.deepEqual([...apps.selected], ["up"]);
  pickMode("user");
  assert.deepEqual([apps.managing, apps.mode, [...apps.selected]], [true, "user", ["up"]]);
  // the list under Manage is still sorted and headed by the mode
  assert.deepEqual(appSections(apps.manageRows, { mode: "user" }).map((s) => s.header), ["D", "G", "M", "O", "U"]);
  setManaging(false);
  assert.deepEqual([apps.managing, apps.selected.size, apps.mode], [false, 0, "user"]);
  togglePick("ok"); // not managing: no pick
  assert.equal(apps.selected.size, 0);
  globalThis.ifizboxNative = { mode: "jailbreak" };
  setManaging(true); // the jailbreak app's lists are unchanged
  assert.equal(apps.managing, false);
});

// ---- B66: Re-sign on a marked app never drops the pick quietly -----------------------------------------------------

// YouMod as the 7's sideload build lists it: installed and marked, not signed by iFizBox.
const youmod = (installed, versions, extra = {}) => withManage({ id: "you.mod", name: "YouMod", version: installed, sig: null, marked: true,
  signed: null, sourceName: "S", ...extra }, new Map(versions ? [["you.mod", { version: versions[0].version, key: "alt:you.mod", pkg: pkg("you.mod", versions) }]] : []));
const harness = (rows, picked, answers = {}) => {
  const log = { alerts: [], sheets: [], ran: [], ended: 0, kept: 0 };
  const view = { manageRows: rows, selected: new Set(picked), managing: true };
  const opts = { view, mode: "sideload", busy: async () => answers.busy ?? false,
    alert: async (o) => { log.alerts.push(o); return { index: answers.alert ? o.buttons.indexOf(answers.alert) : 0 }; },
    sheet: async (o) => { log.sheets.push(o); return 0; },
    run: async (kind, jobs) => { log.ran.push(jobs.map((j) => [j.id, j.mode ?? null, j.url])); return answers.run ? answers.run(jobs) : { done: jobs.length, left: [] }; },
    done: () => log.ended++, keep: () => log.kept++ };
  return { log, view, opts };
};

test("B66: a marked app whose version is on its source: Re-sign (1), the sheet, then its installed version's IPA", async () => {
  const rows = [youmod("19.1", [v("20.0"), v("19.1")])];
  assert.deepEqual(manageToolbar(manageCounts(rows, new Set(["you.mod"])))[0], { kind: "resign", label: "Re-sign (1)", disabled: false });
  const { log, opts } = harness(rows, ["you.mod"]);
  assert.equal(await runManage("resign", opts), true);
  assert.deepEqual(log.alerts, []);
  assert.deepEqual(log.sheets, [{ title: "Each app keeps its data. 1 app is downloaded from its source first.", buttons: ["Re-sign App"] }]);
  assert.deepEqual(log.ran, [[["you.mod", "resign", "https://s/19.1.ipa"]]]);
  assert.equal(log.ended, 1);
});

test("B66: its version gone from the source: Re-sign is enabled, alerts why and offers the newest; Install Newest installs it", async () => {
  const rows = [youmod("19.1", [v("20.0")])];
  assert.deepEqual(manageToolbar(manageCounts(rows, new Set(["you.mod"])))[0], { kind: "resign", label: "Re-sign", disabled: false });
  let h = harness(rows, ["you.mod"]); // Cancel: nothing runs, the pick stays
  assert.equal(await runManage("resign", h.opts), false);
  assert.equal(h.log.alerts[0].title, "Can't Re-sign YouMod");
  assert.equal(h.log.alerts[0].message, "YouMod: its source no longer has version 19.1, the one on your iPhone. Install the newest (20.0) instead: it keeps its data.");
  assert.deepEqual(h.log.alerts[0].buttons, ["Cancel", "Install Newest"]);
  assert.deepEqual([h.log.ran, h.log.ended, [...h.view.selected]], [[], 0, ["you.mod"]]);
  h = harness(rows, ["you.mod"], { alert: "Install Newest" });
  assert.equal(await runManage("resign", h.opts), true);
  assert.deepEqual(h.log.sheets, []); // the alert's button was the confirmation
  assert.deepEqual(h.log.ran, [[["you.mod", null, "https://s/20.0.ipa"]]]);
  assert.equal(h.log.ended, 1);
});

test("B66: no source has it, or no version was marked: the alert says so (OK only when nothing can be done)", async () => {
  let h = harness([youmod("19.1", null)], ["you.mod"]);
  assert.equal(await runManage("resign", h.opts), false);
  assert.deepEqual(h.log.alerts[0].buttons, ["OK"]);
  assert.match(h.log.alerts[0].message, /^YouMod: no source has it now/);
  h = harness([youmod("", [v("20.0")])], ["you.mod"], { alert: "Install Newest" });
  assert.equal(await runManage("resign", h.opts), true);
  assert.match(h.log.alerts[0].message, /marked as installed without a version.*Install the newest \(20\.0\)/);
  assert.deepEqual(h.log.ran, [[["you.mod", null, "https://s/20.0.ipa"]]]);
});

test("B66: blocked with others picked: Re-sign the Others skips it (the sheet counts what runs), Install Newest adds it", async () => {
  const rows = [...fixture(), youmod("19.1", [v("20.0")])];
  let h = harness(rows, ["soon", "you.mod"], { alert: "Re-sign the Other App" });
  assert.equal(await runManage("resign", h.opts), true);
  assert.deepEqual(h.log.alerts[0].buttons, ["Cancel", "Install Newest", "Re-sign the Other App"]);
  assert.equal(h.log.alerts[0].stacked, true);
  assert.deepEqual(h.log.sheets[0].buttons, ["Re-sign App"]);
  assert.deepEqual(h.log.ran, [[["soon", "resign", undefined]]]);
  h = harness(rows, ["soon", "you.mod"], { alert: "Install Newest" });
  await runManage("resign", h.opts);
  assert.deepEqual(h.log.sheets[0], { title: "Each app keeps its data. 1 app is installed at its newest version.", buttons: ["Re-sign 2 Apps"] });
  assert.deepEqual(h.log.ran[0].map((j) => j[0]), ["soon", "you.mod"]);
});

test("B66: a run that fails or never starts keeps Manage and the apps left picked; a run going says so", async () => {
  const rows = [...fixture(), youmod("19.1", [v("20.0"), v("19.1")])];
  let h = harness(rows, ["soon", "you.mod"], { run: () => ({ done: 0, left: ["soon", "you.mod"] }) });
  assert.equal(await runManage("resign", h.opts), true);
  assert.deepEqual([h.log.ended, h.log.kept, [...h.view.selected]], [0, 1, ["soon", "you.mod"]]);
  h = harness(rows, ["soon", "you.mod"], { run: () => ({ done: 1, left: ["you.mod"] }) });
  await runManage("resign", h.opts);
  assert.deepEqual([h.log.ended, [...h.view.selected]], [0, ["you.mod"]]);
  h = harness(rows, ["you.mod"], { busy: true });
  assert.equal(await runManage("resign", h.opts), false);
  assert.equal(h.log.alerts[0].title, "Another Install Is Running");
  assert.deepEqual([h.log.ran, [...h.view.selected]], [[], ["you.mod"]]);
});

test("B66: runManageJobs reports what the queue's run left (a failure stops it), and labels a newest install Installing", async () => {
  const q = createAppQueue();
  const jobs = [{ id: "a", name: "A", mode: "resign" }, { id: "you.mod", name: "YouMod", url: "https://s/20.0.ipa", version: "20.0" }];
  const seen = [];
  const run = async (js, { queue, install }) => {
    await install(js[0]);
    queue.clear(js[0].id);
    await install(js[1]); // fails: stays queued
    return 1;
  };
  assert.deepEqual(await runManageJobs("resign", jobs, { queue: q, run, install: async (j, o) => seen.push(`${o.verb} ${j.name}`) }),
    { done: 1, left: ["you.mod"] });
  assert.deepEqual(seen, ["Re-signing A", "Installing YouMod"]);
});

test("F240: runManageJobs in the sideload app uses the sign-ahead run; failed and cancelled rows come back as left", async () => {
  const q = createAppQueue();
  q.add({ id: "other", name: "Other", url: "https://s/o.ipa" }); // queued before: not part of Manage's run
  const jobs = [{ id: "a", name: "A", mode: "resign" }, { id: "b", name: "B", mode: "resign" }, { id: "c", name: "C", url: "https://s/c.ipa" }];
  let got = null;
  const aheadRun = async (js, { queue }) => {
    got = js.map((j) => j.id);
    queue.clear("a"); // installed; b failed and c was cancelled: both stay queued, the run went past b
    return { ok: false, stopped: false, rows: [], installed: 1 };
  };
  assert.deepEqual(await runManageJobs("resign", jobs, { queue: q, ahead: true, aheadRun, install: async () => assert.fail("no HUD path") }),
    { done: 1, left: ["b", "c"] });
  assert.deepEqual(got, ["a", "b", "c"]);
  assert.ok(q.get("other"));
  // the Signing walkthrough opened instead (null): everything stays picked
  const q2 = createAppQueue();
  assert.deepEqual(await runManageJobs("update", jobs, { queue: q2, ahead: true, aheadRun: async () => null }),
    { done: 0, left: ["a", "b", "c"] });
  // all through: nothing left, so Manage ends
  const q3 = createAppQueue();
  const all = async (js, { queue }) => { for (const j of js) queue.clear(j.id); return { ok: true, installed: js.length }; };
  assert.deepEqual(await runManageJobs("update", jobs, { queue: q3, ahead: true, aheadRun: all }), { done: 3, left: [] });
});

test("F240: runManageJobs without signing ahead (the website) keeps the one-at-a-time run", async () => {
  const q = createAppQueue();
  let used = null;
  const run = async (js, { queue }) => { used = "runAppQueue"; for (const j of js) queue.clear(j.id); return js.length; };
  assert.deepEqual(await runManageJobs("update", [{ id: "x", name: "X", url: "https://s/x.ipa" }], { queue: q, ahead: false, run,
    aheadRun: async () => assert.fail("sign-ahead on the website") }), { done: 1, left: [] });
  assert.equal(used, "runAppQueue");
});

test("B66: markedResignProblem names why and the newest version", async () => {
  const { markedResignProblem } = await import("../core/appqueue.js");
  assert.equal(markedResignProblem(pkg("x", [v("2"), v("1")]), "1"), null);
  assert.deepEqual(markedResignProblem(pkg("x", [v("2")]), "1"), { why: "no-version", newest: "2" });
  assert.deepEqual(markedResignProblem(null, "1"), { why: "no-source", newest: null });
  assert.deepEqual(markedResignProblem(pkg("x", [v("2")]), ""), { why: "unknown-version", newest: "2" });
  assert.deepEqual(markedResignProblem(pkg("x", [{ version: "1" }]), "1"), { why: "no-download", newest: null });
});
