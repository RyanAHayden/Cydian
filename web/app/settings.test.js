// F65: the icon badge N5's daemon sets goes once the Changes tab shows no upgrades, and Upgrade Notifications off
// reaches the daemon again at launch. Jailbreak app only.
import test from "node:test";
import assert from "node:assert/strict";
import { createUpgradeNotices } from "./settings.js";

function fakeNative(extra = {}) {
  const calls = [];
  return { calls, call: async (method, params) => { calls.push([method, params]); return null; }, ...extra };
}
function fakeWin(hash = "#/home") {
  const listeners = [];
  return { location: { hash }, listeners, addEventListener: (type, f) => listeners.push([type, f]) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("0 upgrades on the Changes tab clears the icon badge, once until the count rises again", async () => {
  const native = fakeNative();
  let tab = "changes";
  const up = createUpgradeNotices({ native, current: () => ({ tab, path: [] }), win: fakeWin() });
  assert.equal(up.badge("home", 0), false);
  assert.equal(up.badge("changes", 3), false);
  assert.equal(up.badge("changes", 0), true);
  assert.equal(up.badge("changes", 0), false); // already cleared
  assert.deepEqual(native.calls, [["app.badge", { count: 0 }]]);
  up.badge("changes", 2);
  assert.equal(up.badge("changes", null), true); // the tab bar's "none" is 0 too
  assert.equal(native.calls.length, 2);
  tab = "home";
  up.badge("changes", 1);
  assert.equal(up.badge("changes", 0), false); // counted in the background: the badge stays
});

test("a zero counted elsewhere clears when the user opens Changes", async () => {
  const native = fakeNative();
  const win = fakeWin("#/home");
  const up = createUpgradeNotices({ native, current: () => null, win }); // no router route yet: the hash says
  up.start();
  up.badge("changes", 0);
  assert.deepEqual(native.calls, []);
  win.location.hash = "#/changes";
  for (const [type, f] of win.listeners) if (type === "hashchange") f();
  await tick();
  assert.deepEqual(native.calls, [["app.badge", { count: 0 }]]);
});

test("a failed clear is tried again next time", async () => {
  let fail = true;
  const calls = [];
  const native = { call: async (m) => { calls.push(m); if (fail) throw new Error("no"); } };
  const up = createUpgradeNotices({ native, current: () => ({ tab: "changes", path: [] }), win: fakeWin() });
  up.badge("changes", 0);
  await tick();
  fail = false;
  assert.equal(up.badge("changes", 0), true);
  assert.equal(calls.length, 2);
});

test("the site and the sideload build do nothing", () => {
  const side = fakeNative({ mode: "sideload" });
  const changes = () => ({ tab: "changes", path: [] });
  for (const native of [null, undefined, side]) {
    const up = createUpgradeNotices({ native, current: changes, win: fakeWin() });
    assert.equal(up.badge("changes", 0), false);
    assert.equal(up.start(), false);
  }
  assert.deepEqual(side.calls, []);
});

test("start: Upgrade Notifications off is written again; on, nothing runs", async () => {
  const synced = [];
  const settingsOf = (value) => ({
    isShown: (k) => k === "upgradeNotifications",
    get: () => value,
    upgradeNotifications: { sync: async () => { synced.push(value); return true; } },
  });
  for (const value of [true, false]) {
    const up = createUpgradeNotices({ settings: settingsOf(value), native: fakeNative(), current: () => null, win: fakeWin() });
    assert.equal(up.start(), true);
  }
  await tick();
  assert.deepEqual(synced, [false]);
});

test("app.js wires it beside the tab badge and starts it after the router", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.match(src, /import \{ createUpgradeNotices \} from "\.\/settings\.js";/);
  assert.match(src, /setBadge: \(tab, n\) => \{ tabbar\.setBadge\(tab, n\); upgradeNotices\.badge\(tab, n\); \}/);
  assert.ok(src.indexOf("upgradeNotices.start()") > src.indexOf("router.start()"));
});
