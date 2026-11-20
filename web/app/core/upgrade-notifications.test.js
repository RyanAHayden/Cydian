// F65: Settings' Upgrade Notifications (jailbreak app only), mirrored to N5's daemon through
// `ifizbox-helper notifications on|off`.
import test from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "../test-fakes.js";
import { createSettings } from "./settings.js";

const fakeHelper = (code = 0) => {
  const calls = [];
  const f = async (words) => { calls.push(words.join(" ")); return { code, stdout: "" }; };
  f.calls = calls;
  return f;
};

test("a switch in Notifications, jailbreak app only, on by default", () => {
  for (const mode of ["site", "sideload"]) assert.equal(createSettings({ storage: memStorage(), mode }).isShown("upgradeNotifications"), false);
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  assert.equal(s.isShown("upgradeNotifications"), true);
  assert.equal(s.get("upgradeNotifications"), true);
  const sec = s.sections().find((x) => x.id === "notifications");
  assert.deepEqual(sec.settings.map((d) => [d.key, d.kind, d.label]), [["upgradeNotifications", "toggle", "Upgrade Notifications"]]);
  assert.match(sec.footer, /icon still shows/);
});

test("each change runs the helper; the same value again runs nothing", async () => {
  const helper = fakeHelper();
  const storage = memStorage();
  const s = createSettings({ storage, mode: "jailbreak", helper });
  s.set("upgradeNotifications", false);
  assert.equal(await s.upgradeNotifications.pending, true);
  assert.equal(storage.map.get("ifizbox.upgradeNotifications"), "false");
  s.set("upgradeNotifications", false);
  s.set("upgradeNotifications", true);
  assert.equal(await s.upgradeNotifications.pending, true);
  assert.deepEqual(helper.calls, ["notifications off", "notifications on"]);
});

test("a helper that fails puts the switch back and tells listeners", async () => {
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper: fakeHelper(74) });
  const heard = [];
  s.onChange((k, v) => heard.push(`${k}=${v}`));
  s.set("upgradeNotifications", false);
  assert.equal(await s.upgradeNotifications.pending, false);
  assert.equal(s.get("upgradeNotifications"), true);
  assert.deepEqual(heard, ["upgradeNotifications=false", "upgradeNotifications=true"]);
  // a helper that throws (the bridge failed) does the same
  const t = createSettings({ storage: memStorage(), mode: "jailbreak", helper: async () => { throw new Error("gone"); } });
  t.set("upgradeNotifications", false);
  assert.equal(await t.upgradeNotifications.pending, false);
  assert.equal(t.get("upgradeNotifications"), true);
});

test("sync() writes the stored value; no helper (or another mode) is a no-op", async () => {
  const helper = fakeHelper();
  const s = createSettings({ storage: memStorage({ "ifizbox.upgradeNotifications": "false" }), mode: "jailbreak", helper });
  assert.equal(await s.upgradeNotifications.sync(), true);
  assert.deepEqual(helper.calls, ["notifications off"]);
  const failing = createSettings({ storage: memStorage({ "ifizbox.upgradeNotifications": "false" }), mode: "jailbreak", helper: fakeHelper(1) });
  assert.equal(await failing.upgradeNotifications.sync(), false);
  assert.equal(failing.get("upgradeNotifications"), false); // nothing to undo to at launch: it stays
  const other = fakeHelper();
  const site = createSettings({ storage: memStorage(), mode: "site", helper: other });
  assert.equal(await site.upgradeNotifications.sync(), true);
  assert.equal(await createSettings({ storage: memStorage(), mode: "jailbreak" }).upgradeNotifications.sync(), true);
  assert.deepEqual(other.calls, []);
});
