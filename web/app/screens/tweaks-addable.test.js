// B269: a Tweak Source's list in the sideload build leaves out tweaks already checked and refused on this device
// (the "for iOS itself, not an app you can sign" ones); unchecked and addable ones stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addableTweakRows, INFO_KEY } from "./tweaks.js";
import { sideloadListRows } from "./browse.js";

function memoryStorage(map = {}) {
  const m = new Map(Object.entries(map));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const rows = [
  { id: "com.x.springboard", version: "1.0", name: "SB Tweak" },
  { id: "com.x.youtube", version: "2.0", name: "YT Tweak" },
  { id: "com.x.unchecked", version: "1.0", name: "Unchecked" },
  { id: "com.x.lib", version: "3.0", name: "Lib" },
];
const storage = memoryStorage({ [INFO_KEY]: JSON.stringify({
  "com.x.springboard@1.0": { v: 2, ok: false, why: "It's for iOS itself (SpringBoard or a system app), not an app you can sign.", bundles: [], anyApp: false },
  "com.x.youtube@2.0": { v: 2, ok: true, why: null, bundles: ["com.google.ios.youtube"], anyApp: false },
  "com.x.lib@3.0": { v: 2, ok: false, why: "library", bundles: [], anyApp: false, library: true },
}) });

test("B269 addableTweakRows: refused checks drop out, addable and unchecked rows stay", () => {
  assert.deepEqual(addableTweakRows(rows, { storage }).map((r) => r.id), ["com.x.youtube", "com.x.unchecked"]);
  assert.deepEqual(addableTweakRows(rows, { storage: memoryStorage() }).length, rows.length);
});

test("B269 sideloadListRows: only the sideload build filters a source's list", () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    assert.equal(sideloadListRows(rows, "sideload").length, 2);
    assert.equal(sideloadListRows(rows, "jailbreak").length, rows.length);
    assert.equal(sideloadListRows(rows, "site").length, rows.length);
  } finally { globalThis.localStorage = saved; }
});
