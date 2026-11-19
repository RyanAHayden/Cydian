// B44: the "iFizBox X is out." banner's Upgrade queues exactly iFizBox's own upgrade and opens Confirm, in both
// builds (screens/changes.js upgradeSelf, essential-ui.js bannerUpgrade); with no row yet it opens Changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { upgradeSelf } from "./changes.js";
import { queueApp } from "./queue.js";
import { createQueue } from "../core/queue.js";
import { createAppQueue } from "../core/appqueue.js";
import { bannerUpgrade, bannerDue, bannerSeen } from "../essential-ui.js";
import { installQueue } from "../queue.js";
import { BUNDLE_ID } from "../brand.js";

const self = { id: BUNDLE_ID, name: "iFizBox", version: "0.9.4", installed: "0.9.3", ipa: "https://ifizbox.com/repo/iFizBox.ipa", essential: true };
const other = { id: "com.other.tweak", name: "Other", version: "2", installed: "1", ipa: "https://s/o.ipa" };
const upgrades = (available) => async () => ({ available, ignored: [] });

test("B44 jailbreak: Upgrade queues only com.ryha.ifizbox's upgrade, as a non-quiet add (Confirm opens), no Changes", async () => {
  const q = createQueue();
  const events = [];
  q.subscribe((e) => events.push(e));
  let changes = 0;
  const r = await upgradeSelf({ mode: "jailbreak", upgrades: upgrades([other, self]), queue: () => (job) => q.add(job), changes: () => changes++ });
  assert.equal(r, "queued");
  assert.equal(changes, 0);
  assert.deepEqual(q.list().map((j) => [j.id, j.version, j.mode]), [[BUNDLE_ID, "0.9.4", "upgrade"]]);
  // screens/queue.js initQueue opens Confirm on an add that isn't quiet.
  assert.deepEqual(events.map((e) => [e.type, !!e.quiet]), [["add", false]]);
});

test("B44 sideload: Upgrade queues only iFizBox's own IPA in the app queue and opens its Confirm", async () => {
  const q = createAppQueue();
  const opened = [];
  const add = (job) => queueApp(job, { queue: q, open: (qq) => opened.push(qq.size) });
  let changes = 0;
  const r = await upgradeSelf({ mode: "sideload", upgrades: upgrades([self, other]), add, pkgOf: () => null, changes: () => changes++ });
  assert.equal(r, "queued");
  assert.equal(changes, 0);
  assert.deepEqual(q.list().map((j) => [j.id, j.version, j.url]), [[BUNDLE_ID, "0.9.4", self.ipa]]);
  assert.deepEqual(opened, [1]);
});

test("B44: no iFizBox row (catalog not loaded, failed, or too slow) falls back to Changes and queues nothing", async () => {
  for (const [mode, load] of [["jailbreak", upgrades([other])], ["sideload", async () => { throw new Error("no catalog"); }],
    ["jailbreak", () => new Promise(() => {})]]) {
    const q = createQueue();
    const added = [];
    let changes = 0;
    const r = await upgradeSelf({ mode, upgrades: load, wait: 20, queue: () => (job) => q.add(job), add: (j) => added.push(j), changes: () => changes++ });
    assert.equal(r, "changes", mode);
    assert.equal(changes, 1);
    assert.equal(q.size + added.length, 0);
  }
  // The jailbreak build without a backend queue can't queue it either.
  let changes = 0;
  assert.equal(await upgradeSelf({ mode: "jailbreak", upgrades: upgrades([self]), queue: () => null, changes: () => changes++ }), "changes");
  assert.equal(changes, 1);
});

test("B44: the banner's Upgrade goes through upgradeSelf and gives the banner its once back", async () => {
  let called = 0;
  bannerSeen.version = "0.9.7";
  assert.equal(await bannerUpgrade({ load: async () => ({ upgradeSelf: async () => { called++; return "queued"; } }) }), "queued");
  assert.equal(called, 1);
  assert.equal(bannerSeen.version, null);
});

test("B44: Upgrade then Cancel: the banner shows again at the next check, not while iFizBox is still queued", () => {
  assert.equal(bannerDue("0.9.7", { shown: null, queued: false }), true);
  assert.equal(bannerDue("0.9.7", { shown: "0.9.7", queued: false }), false); // once per version per session
  assert.equal(bannerDue("0.9.7", { shown: null, queued: true }), false);    // tapped, still on Confirm / queued
  assert.equal(bannerDue(null, { shown: null, queued: false }), false);
  // The real queues: iFizBox queued holds it back, cleared (Confirm's Cancel) lets it through.
  bannerSeen.version = null;
  installQueue.add({ op: "install", id: BUNDLE_ID, version: "0.9.7", installed: "0.9.6" }, { quiet: true });
  assert.equal(bannerDue("0.9.7"), false);
  installQueue.clearAll();
  assert.equal(bannerDue("0.9.7"), true);
});
