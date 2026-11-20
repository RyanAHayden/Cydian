// F281: Settings > Ignored Upgrades lists Ignore This Version's entries too ("this version only"), each undone by a tap.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { holdsLayout } from "./settings.js";

test("nothing ignored: one footer that names both ways", () => {
  const g = holdsLayout({});
  assert.equal(g.length, 1);
  assert.match(g[0].footer, /Ignore This Version/);
});

test("holds first, then This Version Only with each version; a tap takes it back", () => {
  const undone = [];
  const g = holdsLayout({ held: ["com.a"], versions: { "com.c": "2.0", "com.b": "1.1" }, footer: "Kept.",
    unhold: (p) => undone.push(["hold", p]), unversion: (id) => undone.push(["version", id]) });
  assert.deepEqual(g.map((x) => x.header), ["Ignored", "This Version Only"]);
  assert.deepEqual(g[1].rows.map((r) => [r.label, r.subtitle]), [["com.b", "1.1, this version only"], ["com.c", "2.0, this version only"]]);
  g[0].rows[0].onClick();
  g[1].rows[1].onClick();
  assert.deepEqual(undone, [["hold", "com.a"], ["version", "com.c"]]);
  assert.deepEqual(holdsLayout({ versions: { x: "1" } }).map((x) => x.header), ["This Version Only"]);
});
