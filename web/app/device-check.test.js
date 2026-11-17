import { test } from "node:test";
import assert from "node:assert/strict";
import { findDeviceUpgrades, isFresh, notificationText, notificationFor, deviceCheck, upgradeKey, BUDGET_MS } from "./device-check.js";

const REPO = "https://repo.example.org/";
const DIST = "https://apt.example.org/";
const DIST_DIR = DIST + "dists/stable/main/binary-iphoneos-arm64/";

const stanza = (pkg, version, arch = "iphoneos-arm64") =>
  `Package: ${pkg}\nVersion: ${version}\nArchitecture: ${arch}\nName: ${pkg[0].toUpperCase() + pkg.slice(1)}\nSection: Tweaks\nFilename: debs/${pkg}.deb\n`;
const status = (rows) => rows.map(([id, v, held]) => `Package: ${id}\nStatus: ${held ? "hold" : "install"} ok installed\nVersion: ${v}\n`).join("\n");

const SOURCES = [{ key: "deb:r", uri: REPO, dist: "./", components: [] }, { key: "deb:d", uri: DIST, dist: "stable", components: ["main"] }];
const FILES = { [REPO]: [stanza("foo", "1.1"), stanza("held", "2"), stanza("quiet", "2"), stanza("other", "9", "iphoneos-arm")].join("\n"), [DIST_DIR]: stanza("bar", "2.0") };
const INPUTS = { sources: SOURCES, status: status([["foo", "1.0"], ["bar", "2.0"], ["held", "1", true], ["quiet", "1"], ["other", "1"]]), holds: ["quiet"], arch: "iphoneos-arm64" };

function packagesFrom(files, seen = []) {
  return async (dir) => {
    seen.push(dir);
    if (!(dir in files)) throw new Error("404");
    return files[dir];
  };
}

test("findDeviceUpgrades: the Changes tab's answer, from the device's lists", async () => {
  const seen = [];
  const r = await findDeviceUpgrades(INPUTS, packagesFrom(FILES, seen));
  assert.deepEqual(r.available, [{ id: "foo", name: "Foo", version: "1.1", installed: "1.0" }]);
  assert.equal(r.failed, 0);
  assert.deepEqual(seen.sort(), [DIST_DIR, REPO]);
  const newer = await findDeviceUpgrades(INPUTS, packagesFrom({ ...FILES, [DIST_DIR]: stanza("bar", "2.1") }));
  assert.deepEqual(newer.available.map(upgradeKey), ["bar=2.1", "foo=1.1"]);
  const down = await findDeviceUpgrades(INPUTS, packagesFrom({ [REPO]: FILES[REPO] }));
  assert.equal(down.failed, 1);
  await assert.rejects(findDeviceUpgrades({ ...INPUTS, status: null }, packagesFrom(FILES)), /status file/);
});

test("rules: fresh only for an upgrade not already seen; text as push.py's", () => {
  const ups = [{ id: "foo", version: "1.1" }, { id: "bar", version: "2" }];
  assert.ok(isFresh(ups, []));
  assert.ok(!isFresh(ups, ups.map(upgradeKey)));
  assert.ok(!isFresh(ups.slice(1), ups.map(upgradeKey)));
  assert.ok(isFresh([{ id: "foo", version: "1.2" }], ups.map(upgradeKey)));
  const named = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase(), version: "1" }));
  assert.equal(notificationText([{ id: "foo", name: "Foo", version: "1.1" }]), "Foo 1.1 is available.");
  assert.equal(notificationText(named("a", "b")), "2 upgrades: A and B.");
  assert.equal(notificationText(named("a", "b", "c")), "3 upgrades: A, B and C.");
  assert.equal(notificationText(named("a", "b", "c", "d", "e")), "5 upgrades: A, B, C and 2 more.");
  assert.equal(notificationFor({ outcome: "ok", available: [] }).title, "No Upgrades");
  assert.deepEqual(notificationFor({ outcome: "ok", available: named("a", "b"), fresh: true }), { title: "2 Upgrades", body: "2 upgrades: A and B.", fresh: true });
  assert.match(notificationFor({ outcome: "ok", available: named("a"), fresh: false }).body, /^Nothing new/);
  assert.equal(notificationFor({ outcome: "timeout", lastCount: 3 }).title, "3 Upgrades");
  assert.match(notificationFor({ outcome: "error" }).body, /Open Cydian/);
});

function fakeEnv(over = {}) {
  const { initial = {}, ...rest } = over;
  const log = { shown: [], acks: [], badges: [], state: initial };
  let t = 1000;
  const env = {
    inputs: async () => INPUTS,
    packages: packagesFrom(FILES),
    state: async () => log.state,
    saveState: async (s) => { log.state = s; },
    show: async (title, opts) => { log.shown.push({ title, ...opts }); },
    badge: async (n) => { log.badges.push(n); },
    ack: async (b) => { log.acks.push(b); },
    now: () => (t += 250),
    budget: BUDGET_MS,
    ...rest,
  };
  return { env, log };
}

test("deviceCheck: shows the count, files the baseline, acks with the time it took", async () => {
  const { env, log } = fakeEnv();
  const r = await deviceCheck({ type: "check", id: "sid", seq: 4 }, env);
  assert.equal(r.outcome, "ok");
  assert.equal(r.fresh, true);
  assert.equal(log.shown[0].title, "1 Upgrade");
  assert.equal(log.shown[0].body, "Foo 1.1 is available.");
  assert.equal(log.shown[0].tag, "cydian-upgrades");
  assert.equal(log.shown[0].silent, false);
  assert.deepEqual(log.badges, [1]);
  assert.deepEqual(log.state.notified, ["foo=1.1"]);
  assert.deepEqual(log.acks, [{ id: "sid", seq: 4, ms: 250, outcome: "ok" }]);
  // the next day, the same list: a quiet notification (iOS needs one), not fresh
  const again = await deviceCheck({ type: "check", id: "sid", seq: 5 }, env);
  assert.equal(again.fresh, false);
  assert.equal(log.shown[1].silent, true);
  assert.match(log.shown[1].body, /^Nothing new/);
});

test("deviceCheck: past the budget a notification still goes up, and the timeout is reported", async () => {
  const { env, log } = fakeEnv({ budget: 20, packages: () => new Promise(() => {}), initial: { notified: ["foo=1.0"], last: { count: 2 } } });
  const r = await deviceCheck({ type: "check", id: "sid", seq: 1 }, env);
  assert.equal(r.outcome, "timeout");
  assert.equal(log.shown[0].title, "2 Upgrades");
  assert.match(log.shown[0].body, /too long/);
  assert.deepEqual(log.state.notified, ["foo=1.0"]); // the baseline doesn't move
  assert.equal(log.acks[0].outcome, "timeout");
  assert.deepEqual(log.badges, []);
});

test("deviceCheck: no status file is an error notification, never a silent push", async () => {
  const { env, log } = fakeEnv({ inputs: async () => ({ ...INPUTS, status: null }) });
  const r = await deviceCheck({ type: "check" }, env);
  assert.equal(r.outcome, "error");
  assert.equal(log.shown.length, 1);
  assert.equal(log.acks.length, 0); // no id, no ack
});

test("sw-device.js loads as a module worker over sw.js and answers a check push", async () => {
  const listeners = {};
  const shown = [];
  const fetches = [];
  const prev = { self: globalThis.self, fetch: globalThis.fetch };
  globalThis.self = {
    addEventListener: (type, f) => { listeners[type] = f; },
    registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    navigator: {},
    location: { origin: "https://cydian.example" },
    fetch: async (url, init) => { fetches.push([url, init]); return new Response("{}"); },
  };
  globalThis.fetch = globalThis.self.fetch;
  try {
    await import("./sw-device.js");
    assert.equal(typeof globalThis.self.cydianDeviceCheck, "function");
    assert.ok(listeners.push && listeners.notificationclick && listeners.install);
    let waited;
    listeners.push({ data: { json: () => ({ type: "check", id: "sid", seq: 2 }) }, waitUntil: (p) => { waited = p; } });
    const r = await waited;
    // node has no IndexedDB: the check fails, but it still shows a notification and acks how it went
    assert.equal(r.outcome, "error");
    assert.equal(shown.length, 1);
    assert.equal(shown[0].tag, "cydian-upgrades");
    const ack = fetches.find(([u]) => u === "/api/push/ack");
    assert.equal(JSON.parse(ack[1].body).outcome, "error");
  } finally {
    globalThis.self = prev.self;
    globalThis.fetch = prev.fetch;
  }
});
