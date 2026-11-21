// The concept shell's in-memory IndexedDB (tools/concept/shell.js memoryIndexedDB, what the phone uses where the
// browser refuses IndexedDB) under web/app's own stores. Run by test_shell_idb.py. SPDX-License-Identifier: GPL-3.0-or-later
//   node tools/concept/idb.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../..", import.meta.url));
const src = readFileSync(root + "/tools/concept/shell.js", "utf8");
const start = src.indexOf("  function memoryIndexedDB()"), end = src.indexOf("  } // end memoryIndexedDB");
assert.ok(start > 0 && end > start, "shell.js has memoryIndexedDB() ... // end memoryIndexedDB");
const memoryIndexedDB = new Function(src.slice(start, end) + "  }\nreturn memoryIndexedDB;")();
const { openSourceStore } = await import(root + "/web/app/core/sources.js");
const { openIndexCache } = await import(root + "/web/app/core/cache.js");
const { openSeenStore } = await import(root + "/web/app/core/changes.js");
const { openAppStore } = await import(root + "/web/app/core/installed.js");

const idb = memoryIndexedDB();
const s = await openSourceStore({ indexedDB: idb, defaults: [{ key: "b", uri: "b" }, { key: "a", uri: "a" }] });
assert.equal((await s.list()).length, 2);
await s.put({ key: "c", uri: "c" });
assert.deepEqual((await s.get("c")).uri, "c");
await s.remove("a");
const s2 = await openSourceStore({ indexedDB: idb, defaults: [{ key: "a", uri: "a" }] }); // seeded once: a stays deleted
assert.deepEqual((await s2.list()).map((x) => x.key).sort(), ["b", "c"]);

const c = await openIndexCache({ indexedDB: idb });
await c.put("u2", { n: 2 }); await c.put("u1", { n: 1 });
assert.deepEqual(await c.keys(), ["u1", "u2"]);
const rec = await c.get("u1"); rec.value.n = 9; assert.equal((await c.get("u1")).value.n, 1); // cloned
await c.clear(); assert.deepEqual(await c.keys(), []);

const seen = await openSeenStore({ indexedDB: idb });
await seen.putMany(Array.from({ length: 500 }, (_, i) => ({ k: "p" + i })));
assert.equal((await seen.all()).length, 500);

const apps = await openAppStore({ indexedDB: idb });
await apps.put({ id: "x" }); assert.equal((await apps.all()).length, 1);

// out-of-line keys, add's ConstraintError aborting (and undoing) the transaction, version upgrades, readonly writes
await new Promise((ok, fail) => {
  const req = idb.open("kv", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onerror = () => fail(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction("kv", "readwrite");
    t.objectStore("kv").put("v1", "key");
    t.oncomplete = () => {
      const t2 = db.transaction("kv", "readwrite"), st = t2.objectStore("kv");
      st.put("v2", "other");
      st.add("dup", "key");
      t2.oncomplete = () => fail(new Error("should abort"));
      t2.onabort = () => {
        assert.equal(t2.error.name, "ConstraintError");
        const t3 = db.transaction(["kv"]), g = t3.objectStore("kv").getAllKeys();
        assert.throws(() => t3.objectStore("kv").put("x", "y"), { name: "ReadOnlyError" });
        t3.oncomplete = () => { assert.deepEqual(g.result, ["key"]); ok(); }; // "other" undone
      };
    };
  };
});
await new Promise((ok, fail) => {
  const req = idb.open("kv", 2);
  let up = null;
  req.onupgradeneeded = (e) => { up = [e.oldVersion, e.newVersion]; req.result.createObjectStore("more", { keyPath: "id" }); };
  req.onsuccess = () => { assert.deepEqual(up, [1, 2]); assert.ok(req.result.objectStoreNames.contains("more")); assert.equal(req.result.version, 2); ok(); };
  req.onerror = () => fail(req.error);
});
await new Promise((ok) => { const req = idb.open("kv", 1); req.onerror = () => { assert.equal(req.error.name, "VersionError"); ok(); }; });
console.log("memory IndexedDB: all ok");
