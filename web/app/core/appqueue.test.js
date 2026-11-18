// F80: the sideload app's install queue (core/appqueue.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppQueue, appJob, appPlan, runOrder, appNavLabel, modifyActions, sizeText, SELF_ID } from "./appqueue.js";

const pkg = (id, versions, extra = {}) => ({ key: "alt:https://s/", row: { id, name: id.toUpperCase() },
  stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: id.toUpperCase(), sourceUrl: "https://s/apps.json", sourceName: "S",
    iconURL: `https://s/${id}.png`, versions, ...extra } } });

test("an app queue: one job per app, its mode, replaced when queued again, events for each change", () => {
  const q = createAppQueue();
  const seen = [];
  q.subscribe((e) => seen.push(e.type));
  assert.equal(q.add({ id: "a", name: "A", version: "2", installed: "1", url: "https://x/a.ipa" }).mode, "upgrade");
  assert.equal(q.add({ id: "b", version: "1", url: "https://x/b.ipa" }).mode, "install");
  assert.equal(q.add({ id: "a", version: "1", installed: "1", url: "https://x/a.ipa" }).mode, "reinstall");
  assert.deepEqual(q.list().map((j) => `${j.id}:${j.mode}`), ["a:reinstall", "b:install"]);
  assert.equal(q.size, 2);
  q.clear("a");
  q.clear("nope");
  assert.equal(q.get("a"), null);
  q.clearAll();
  q.clearAll();
  assert.deepEqual(seen, ["add", "add", "add", "clear", "clearAll"]);
  assert.throws(() => q.add({ id: "c" }), /no IPA/);
  assert.throws(() => q.add({ url: "https://x" }), /no app id/);
});

test("appJob: the newest version (or the one asked), its IPA, size and record fields; none for a source-signed link", () => {
  const p = pkg("com.x.a", [{ version: "2.0", downloadURL: "https://s/a2.ipa", size: 3145728 }, { version: "1.0", downloadURL: "https://s/a1.ipa" }]);
  assert.deepEqual(appJob(p, { installed: "1.0" }), { id: "com.x.a", name: "COM.X.A", version: "2.0", installed: "1.0", url: "https://s/a2.ipa",
    size: 3145728, icon: "https://s/com.x.a.png", key: "alt:https://s/", source: "https://s/apps.json", sourceName: "S" });
  assert.equal(appJob(p, { version: "1.0" }).url, "https://s/a1.ipa");
  assert.equal(appJob(pkg("i", [{ version: "1", downloadURL: "itms-services://?action=download-manifest&url=x" }])), null);
  assert.equal(appJob(pkg("n", [])), null);
  assert.equal(appJob({ stanza: { kind: "deb" } }), null);
});

test("appPlan: Confirm's groups (core/queue.js parseSimulation's shape) and the total download", () => {
  const q = createAppQueue();
  q.add({ id: "a", version: "2", installed: "1", url: "u", size: 1048576 });
  q.add({ id: "b", version: "1", url: "u", size: 2097152,
    deps: [{ id: "lib", version: "3", size: 1048576 }, { id: "a", version: "2", installed: "1" }] });
  const plan = appPlan(q.list());
  assert.deepEqual(plan.installs.map((e) => e.id), ["lib", "b"]); // a dependency shows under Install, ahead of its app
  assert.deepEqual(plan.upgrades, [{ id: "a", from: "1", to: "2" }]); // listed once
  assert.deepEqual([plan.reinstalls, plan.downgrades, plan.removes, plan.essential], [[], [], [], []]);
  assert.equal(plan.download, "4.0 MB");
  assert.equal(appPlan([]).download, null);
  assert.equal(sizeText(2048), "2 kB");
});

test("runOrder: as queued, iFizBox itself last", () => {
  assert.deepEqual(runOrder([{ id: SELF_ID }, { id: "a" }, { id: "b" }]).map((j) => j.id), ["a", "b", SELF_ID]);
});

test("the app page's nav button: Modify while queued, else Install / Upgrade / Reinstall; Modify offers Clear first", () => {
  assert.equal(appNavLabel({}), "Install");
  assert.equal(appNavLabel({ installed: "1", newest: "2" }), "Modify"); // installed: Modify, as Cydia's
  assert.equal(appNavLabel({ installed: "2", newest: "2" }), "Modify");
  assert.equal(appNavLabel({ installed: "", newest: "2" }), "Modify"); // marked installed, version unknown
  assert.deepEqual(modifyActions({ installed: "1", newest: "2" }), ["Upgrade"]);
  assert.deepEqual(modifyActions({ installed: "2", newest: "2", older: true }), ["Reinstall", "Downgrade"]);
  assert.deepEqual(modifyActions({}), ["Install"]);
  assert.equal(appNavLabel({ queued: true, installed: "1", newest: "2" }), "Modify");
  assert.equal(appNavLabel({ queued: true }), "Modify");
  assert.deepEqual(modifyActions({ queued: true, installed: "1", newest: "2" }), ["Clear", "Upgrade"]);
  assert.deepEqual(modifyActions({ queued: true }), ["Clear", "Install"]);
  assert.deepEqual(modifyActions({}), ["Install"]);
});
