// F226: the package page's Block group, Settings > Blocked, and Changes filing blocked upgrades as ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockRows } from "./browse.js";
import { blockedLayout, nav } from "./settings.js";
import { ignoredList } from "./changes.js";
import { findUpgrades } from "../core/installed.js";

test("package page: Block This Package and Block Packages by <author>, each turning into Unblock", () => {
  const off = blockRows({ name: "Foo", author: "Jane" });
  assert.deepEqual(off.rows.map((r) => r.label), ["Block This Package", "Block Packages by Jane"]);
  assert.equal(off.rows[0].confirm.button, "Block Package");
  assert.match(off.rows[0].confirm.title, /^Foo will leave Browse, Search, Sections and Changes/);
  assert.equal(off.rows[1].confirm.button, "Block Author");
  assert.equal(off.footer, null);
  const on = blockRows({ name: "Foo", author: "Jane", blockedNow: true, authorBlocked: true });
  assert.deepEqual(on.rows.map((r) => r.label), ["Unblock This Package", "Unblock Jane"]);
  assert.ok(on.rows.every((r) => r.confirm === null)); // unblocking asks nothing
  assert.match(on.footer, /this device/);
  assert.deepEqual(blockRows({ name: "Foo" }).rows.map((r) => r.key), ["package"]); // no author, no author row
});

test("package page: the jailbreak app says an installed package is held too", () => {
  assert.match(blockRows({ name: "Foo", mode: "jailbreak", installed: true }).footer, /holds it with dpkg/);
  assert.match(blockRows({ name: "Foo", mode: "jailbreak", installed: true, blockedNow: true }).footer, /held with dpkg/);
  assert.equal(blockRows({ name: "Foo", mode: "jailbreak", installed: false }).footer, null);
  assert.equal(blockRows({ name: "Foo", mode: "sideload", installed: true }).footer, null);
});

test("Settings > Blocked: packages and authors, checked; empty says how to block", () => {
  const empty = blockedLayout({});
  assert.equal(empty.length, 2); // F317: the mode's sentence is a group of its own, last
  assert.match(empty[0].footer, /^Nothing is blocked/);
  assert.match(empty[1].footer, /kept on this device/);
  assert.match(blockedLayout({ mode: "jailbreak" }).at(-1).footer, /held with dpkg/);
  const g = blockedLayout({ entries: [{ id: "com.a", name: "Ay" }, { id: "b", name: "b" }], authors: ["Jane"] });
  assert.deepEqual(g.map((x) => x.header), ["Packages", "Authors", undefined]);
  assert.doesNotMatch(g[0].footer, /device|dpkg/);
  assert.deepEqual(g[0].rows, [{ id: "com.a", label: "Ay", subtitle: "com.a", checked: true }, { id: "b", label: "b", subtitle: undefined, checked: true }]);
  assert.deepEqual(g[1].rows, [{ author: "Jane", label: "Jane", checked: true }]);
  assert.deepEqual(blockedLayout({ authors: ["Jane"] }).map((x) => x.header), ["Authors", undefined]);
  assert.equal(nav({ tab: "home", path: ["general", "blocked"] }).title, "Blocked");
});

test("Changes: a blocked package's upgrade is filed under Ignored, never Available", () => {
  assert.deepEqual(ignoredList(["b", "a"], ["c", "a"]), ["a", "b", "c"]);
  const installed = [{ id: "tweak", version: "1" }, { id: "other", version: "1" }];
  const row = (id) => ({ id, name: id, version: "2" });
  const u = findUpgrades(installed, row, ignoredList([], ["tweak"]));
  assert.deepEqual(u.available.map((r) => r.id), ["other"]);
  assert.deepEqual(u.ignored.map((r) => r.id), ["tweak"]);
});
