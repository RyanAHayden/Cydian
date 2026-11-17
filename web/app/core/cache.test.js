import { test } from "node:test";
import assert from "node:assert/strict";
import { openIndexCache } from "./cache.js";

// The slice of IndexedDB that cache.js uses, in memory: open with upgradeneeded, one keyPath store, async
// requests and transaction completion. structuredClone stands in for IDB's copy-on-write.
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (f) => setTimeout(f, 0);
  return {
    open(name, version) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) {
          const stores = new Map();
          db = {
            stores, version,
            objectStoreNames: { contains: (n) => stores.has(n) },
            createObjectStore(n, { keyPath }) { stores.set(n, { keyPath, rows: new Map() }); },
            transaction(n, mode) {
              const s = stores.get(n);
              const tx = {};
              const request = (f) => {
                const r = {};
                later(() => { r.result = f(); later(() => tx.oncomplete?.()); });
                return r;
              };
              tx.objectStore = () => ({
                get: (k) => request(() => structuredClone(s.rows.get(k))),
                put: (v) => { if (mode !== "readwrite") throw new Error("read-only"); return request(() => { s.rows.set(v[s.keyPath], structuredClone(v)); return v[s.keyPath]; }); },
                delete: (k) => request(() => { s.rows.delete(k); }),
                clear: () => request(() => { s.rows.clear(); }),
                getAllKeys: () => request(() => [...s.rows.keys()].sort()),
              });
              return tx;
            },
            close() { this.closed = true; },
          };
          dbs.set(name, db);
        }
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

test("index cache: put, get, keys, delete, clear, survives reopening", async () => {
  const indexedDB = fakeIndexedDB();
  const cache = await openIndexCache({ indexedDB });
  assert.equal(await cache.get("https://r.example/Packages"), undefined);
  const value = [{ package: "a", version: "1", debUrl: "https://r.example/a.deb" }];
  const before = Date.now();
  await cache.put("https://r.example/Packages", value, { etag: '"x1"' });
  const rec = await cache.get("https://r.example/Packages");
  assert.deepEqual(rec.value, value);
  assert.equal(rec.etag, '"x1"');
  assert.equal(rec.lastModified, null);
  assert.ok(rec.savedAt >= before);
  await cache.put("https://b.example/Packages", []);
  assert.deepEqual(await cache.keys(), ["https://b.example/Packages", "https://r.example/Packages"]);
  cache.close();

  const again = await openIndexCache({ indexedDB });
  assert.deepEqual((await again.get("https://r.example/Packages")).value, value);
  await again.delete("https://r.example/Packages");
  assert.deepEqual(await again.keys(), ["https://b.example/Packages"]);
  await again.clear();
  assert.deepEqual(await again.keys(), []);
});

test("index cache: no IndexedDB is a rejection, not a throw", async () => {
  await assert.rejects(openIndexCache({ indexedDB: null }), /not available/);
});
