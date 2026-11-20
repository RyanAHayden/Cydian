// F281: Ignore This Version: one version hidden per package or app ({ id: version }), shown again at the next one,
// dropped once a newer version comes or the installed one reaches it; synced like holds.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitIgnoredVersions, settleIgnoredVersions, ignoreVersionLabel, withVersionButton, versionToStore, versionLines,
  applyVersionLines, IGNORE_VERSION, STOP_IGNORING_VERSION } from "./appupdates.js";
import { createSettings } from "./settings.js";
import { mergePayload, summarize, changesFor } from "./account.js";
import { encodeLink, decodeLink, reviewLink } from "./transfer.js";

const row = (id, installed, version, extra = {}) => ({ id, name: id, installed, version, ...extra });

test("the ignored version is hidden: its row moves under ignored, marked; the badge's list (available) leaves it out", () => {
  const up = { available: [row("a", "1.0", "1.1"), row("b", "2", "3")], ignored: [row("h", "1", "2")] };
  const out = splitIgnoredVersions(up, { a: "1.1" });
  assert.deepEqual(out.available.map((r) => r.id), ["b"]);
  assert.deepEqual(out.ignored.map((r) => [r.id, Boolean(r.ignoredVersion)]), [["a", true], ["h", false]]);
});

test("the next newer version shows again; versions compare as dpkg does (1.1 = 1.1-0)", () => {
  const up = { available: [row("a", "1.0", "1.2")], ignored: [] };
  assert.deepEqual(splitIgnoredVersions(up, { a: "1.1" }).available.map((r) => r.id), ["a"]);
  assert.equal(splitIgnoredVersions({ available: [row("a", "1.0", "1.1-0")], ignored: [] }, { a: "1.1" }).available.length, 0);
  assert.equal(splitIgnoredVersions(up, {}), up); // nothing ignored: the same object back
});

test("settle: dropped once a newer version is on offer or the installed version reaches it; kept otherwise", () => {
  const versions = { newer: "1.1", reached: "2.0", past: "2.0", still: "3.0", unknown: "1.0" };
  const upgrades = { available: [row("newer", "1.0", "1.2")], ignored: [row("still", "2.0", "3.0", { ignoredVersion: true })] };
  const installed = { reached: "2.0", past: "2.5" };
  const next = settleIgnoredVersions(versions, { upgrades, installedOf: (id) => installed[id] ?? null });
  assert.deepEqual(next, { still: "3.0", unknown: "1.0" });
});

test("the sheet's label: Ignore This Version while an upgrade is out, Stop Ignoring while that version is ignored", () => {
  assert.equal(ignoreVersionLabel({ installed: "1", newest: "2" }), IGNORE_VERSION);
  assert.equal(ignoreVersionLabel({ installed: "1", newest: "2", ignored: "2" }), STOP_IGNORING_VERSION);
  assert.equal(ignoreVersionLabel({ installed: "1", newest: "3", ignored: "2" }), IGNORE_VERSION); // a newer one came
  assert.equal(ignoreVersionLabel({ installed: "2", newest: "2" }), null); // up to date
  assert.equal(ignoreVersionLabel({ installed: "1", newest: "2", held: true }), null); // Ignore Upgrades has it
  assert.equal(ignoreVersionLabel({ installed: "", newest: "2" }), null);
  assert.deepEqual(withVersionButton(["Upgrade", "Remove"], IGNORE_VERSION), ["Upgrade", IGNORE_VERSION, "Remove"]);
  assert.deepEqual(withVersionButton(["Reinstall", "Remove"], IGNORE_VERSION), ["Reinstall", IGNORE_VERSION, "Remove"]);
  assert.deepEqual(withVersionButton(["Remove"], null), ["Remove"]);
  assert.equal(versionToStore(IGNORE_VERSION, "2"), "2");
  assert.equal(versionToStore(STOP_IGNORING_VERSION, "2"), null);
});

test("settings: kept per item on the device, listeners told, undone with null; junk in storage reads as nothing", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const s = createSettings({ storage });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  s.ignoredVersions.set("b.app", "2.0");
  s.ignoredVersions.set("a.pkg", "1.1");
  assert.deepEqual(s.ignoredVersions.all(), { "a.pkg": "1.1", "b.app": "2.0" });
  assert.equal(s.ignoredVersions.get("a.pkg"), "1.1");
  assert.deepEqual(s.ignoredVersions.lines(), ["a.pkg 1.1", "b.app 2.0"]);
  assert.deepEqual(createSettings({ storage }).ignoredVersions.all(), { "a.pkg": "1.1", "b.app": "2.0" }); // stored
  s.ignoredVersions.set("a.pkg", null);
  assert.deepEqual(heard.at(-1), ["ignoredVersions", { "b.app": "2.0" }]);
  s.ignoredVersions.replace({});
  assert.equal(mem.has("ifizbox.ignoredVersions"), false);
  mem.set("ifizbox.ignoredVersions", "[1,2]");
  assert.deepEqual(s.ignoredVersions.all(), {});
  assert.equal(s.holds.list().length, 0); // holds untouched
});

test("account sync: lines merge three ways like holds; changes say what to add and remove", () => {
  const local = { sources: [], settings: {}, holds: [], ignoredVersions: ["a 1.1", "b 2"], apps: [] };
  const first = mergePayload(local, null, null, 1);
  assert.deepEqual(first.ignoredVersions, ["a 1.1", "b 2"]);
  const seen = summarize(first);
  // This device took b back since; another device added c.
  const remote = { ...first, ignoredVersions: ["a 1.1", "b 2", "c 3"] };
  const merged = mergePayload({ ...local, ignoredVersions: ["a 1.1"] }, remote, seen, 2);
  assert.deepEqual(merged.ignoredVersions, ["a 1.1", "c 3"]);
  const c = changesFor({ ...local, ignoredVersions: ["a 1.1"] }, merged);
  assert.deepEqual(c.addVersions, ["c 3"]);
  assert.equal(c.removeVersions, undefined);
  assert.equal(c.empty, false);
  // None anywhere: no field, so payloads from before F281 compare equal.
  assert.equal("ignoredVersions" in mergePayload({ sources: [], settings: {}, holds: [], apps: [] }, null, null, 1), false);
  assert.equal("ignoredVersions" in summarize({}), false);
});

test("account sync applies lines: a removed one only while the version matches, the newer of two adds stands", () => {
  assert.deepEqual(versionLines({ b: "2", a: "1" }), ["a 1", "b 2"]);
  assert.deepEqual(applyVersionLines({ a: "1", b: "5" }, { remove: ["a 1", "b 2"], add: ["c 1", "c 2", "c 1.5", "bad"] }), { b: "5", c: "2" });
});

test("Open in App link carries them; the app takes only the ones it doesn't have", async () => {
  const link = await encodeLink({ sources: [], holds: [], versions: { a: "1.1", b: "2" } });
  const p = await decodeLink(link);
  assert.deepEqual(p.versions, { a: "1.1", b: "2" });
  const r = reviewLink(p, { versions: { a: "1.1" } });
  assert.deepEqual(r.versions, { b: "2" });
  assert.equal(r.empty, false);
  const none = reviewLink(p, { versions: { a: "1.1", b: "2" } });
  assert.equal(none.versions, undefined);
  assert.equal(none.empty, true);
  assert.equal((await decodeLink(await encodeLink({}))).versions, undefined);
});
