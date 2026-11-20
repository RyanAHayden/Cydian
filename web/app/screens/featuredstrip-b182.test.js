// B182: a source page's banner strip draws only banners whose package the catalog has for that source, so no tile
// opens "Package not found" (the sideload app's Tweak Sources keep injectable tweaks only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { featuredStrip } from "./extras.js";
import { withDocument as withDom } from "../fakes.test-helper.js";

const source = { key: "https://repo.chariz.com/", uri: "https://repo.chariz.com/" };
const f = { itemSize: { width: 263, height: 148 }, radius: 10, banners: [
  { package: "com.ryannair05.mitsuhaforever", title: "Mitsuha Forever", url: "https://cdn.chariz.cloud/m.jpg", displayText: false },
  { package: "com.greg0109.lockshut", title: "LockShut", url: "https://cdn.chariz.cloud/l.jpg", displayText: false },
  { package: "com.antonym.drift", title: "Drift", url: "https://cdn.chariz.cloud/d.jpg", displayText: false },
] };
const attached = (box) => { box.parentNode = {}; return box; };

test("B182: the strip links only the banners the catalog has, each to its package page", () => withDom(async () => {
  const have = new Set(["com.greg0109.lockshut", "com.antonym.drift"]);
  const box = attached(featuredStrip(source, { get: async () => f, has: async (id) => (have.has(id) ? { stanza: {} } : null) }));
  await box.ready;
  assert.equal(box.children.length, 1);
  const row = box.children[0];
  assert.deepEqual(row.children.map((a) => a.attrs["aria-label"]), ["LockShut", "Drift"]);
  for (const a of row.children) assert.match(decodeURIComponent(a.href), /lockshut|drift/);
}));

test("B182: no banner's package in the catalog (or a failed lookup): no strip at all", () => withDom(async () => {
  const none = attached(featuredStrip(source, { get: async () => f, has: async () => null }));
  await none.ready;
  assert.equal(none.children.length, 0);
  const bad = attached(featuredStrip(source, { get: async () => f, has: async () => { throw new Error("down"); } }));
  await bad.ready;
  assert.equal(bad.children.length, 0);
}));
